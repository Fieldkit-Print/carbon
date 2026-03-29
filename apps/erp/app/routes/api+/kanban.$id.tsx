import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { Loading } from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionRegion } from "@supabase/supabase-js";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";
import { Redirect } from "~/components/Redirect";
import { getDefaultShelfForJob, getKanban } from "~/modules/inventory";
import { getItemReplenishment } from "~/modules/items";
import {
  getActiveJobOperationByJobId,
  runMRP,
  updateKanbanJob,
  upsertJob,
  upsertJobMethod
} from "~/modules/production";
import {
  upsertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";
import { tasks } from "~/utils/tasks";

async function handleKanban({
  client,
  companyId,
  userId,
  id
}: {
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  id: string;
}): Promise<{ data: string; error: null } | { data: null; error: string }> {
  const kanban = await getKanban(client, id);
  if (
    kanban.data?.replenishmentSystem === "Make" &&
    kanban.data?.jobReadableId
  ) {
    return {
      data: path.to.api.kanbanCollision(id),
      error: null
    };
  }

  if (kanban.error || !kanban.data) {
    return {
      data: null,
      error: "Kanban is not active"
    };
  }

  if (kanban.data.companyId !== companyId) {
    return {
      data: null,
      error: "Kanban is not active"
    };
  }

  if (kanban.data.replenishmentSystem === "Make") {
    if (!kanban.data.itemId) {
      return {
        data: null,
        error: "Failed to create job"
      };
    }

    const [nextSequence, manufacturing, defaultShelf] = await Promise.all([
      getNextSequence(client, "job", companyId),
      getItemReplenishment(client, kanban.data.itemId!, companyId),
      getDefaultShelfForJob(
        client,
        kanban.data.itemId!,
        kanban.data.locationId!,
        companyId
      )
    ]);

    if (nextSequence.error) {
      console.error(nextSequence.error);
      return {
        data: null,
        error: "Failed to create job"
      };
    }

    let jobReadableId = nextSequence.data;
    let leadTime = manufacturing.data?.leadTime ?? 7;

    const startDate = today(getLocalTimeZone());
    const dueDate = startDate.add({ days: leadTime }).toString();

    if (!jobReadableId) {
      console.error("Failed to get next job id");
      return {
        data: null,
        error: "Failed to create job"
      };
    }

    // Use shelf from kanban if it exists, otherwise use default shelf
    const shelfId = kanban.data.shelfId || defaultShelf || undefined;

    const createdJob = await upsertJob(client, {
      jobId: jobReadableId,
      itemId: kanban.data.itemId!,
      quantity: kanban.data.quantity!,
      locationId: kanban.data.locationId!,
      shelfId,
      unitOfMeasureCode: kanban.data.purchaseUnitOfMeasureCode!,
      deadlineType: "Hard Deadline",
      scrapQuantity: 0,
      startDate: startDate.toString(),
      dueDate,
      companyId,
      createdBy: userId
    });

    const id = createdJob.data?.id!;
    if (createdJob.error || !id) {
      console.error(createdJob.error);
      return {
        data: null,
        error: "Failed to create job"
      };
    }

    const serviceRole = getCarbonServiceRole();

    const [upsertMethod, associateKanban] = await Promise.all([
      upsertJobMethod(serviceRole, "itemToJob", {
        sourceId: kanban.data.itemId!,
        targetId: id,
        companyId,
        userId,
        configuration: undefined
      }),
      updateKanbanJob(serviceRole, {
        id: kanban.data.id!,
        jobId: id,
        companyId,
        userId
      })
    ]);

    if (associateKanban.error) {
      console.error(associateKanban.error);
      return {
        data: null,
        error: "Failed to associate kanban with job"
      };
    }

    if (!upsertMethod.error && kanban.data.autoRelease) {
      await Promise.all([
        tasks.trigger("recalculate", {
          type: "jobRequirements",
          id,
          companyId,
          userId
        }),
        runMRP(serviceRole, {
          type: "job",
          id,
          companyId,
          userId
        }),
        serviceRole.functions.invoke("schedule", {
          body: {
            jobId: id,
            companyId,
            userId,
            mode: "initial",
            direction: "backward"
          },
          region: FunctionRegion.UsWest2
        }),
        serviceRole
          .from("job")
          .update({
            status: "Ready" as const
          })
          .eq("id", jobReadableId)
      ]);
    } else if (upsertMethod.error) {
      console.error(upsertMethod.error);
    }

    const jobId = id;
    let redirectUrl = path.to.job(jobId);

    const operation = await getActiveJobOperationByJobId(
      client,
      jobId,
      companyId
    );

    if (operation && kanban.data.autoRelease) {
      let operationId = operation.id;
      if (kanban.data.autoStartJob) {
        let setupTime = operation.setupTime;
        let laborTime = operation.laborTime;
        let machineTime = operation.machineTime;
        let type: "Setup" | "Labor" | "Machine" = "Labor";
        if (machineTime && !laborTime) {
          type = "Machine";
        }
        if (setupTime) {
          type = "Setup";
        }
        redirectUrl = path.to.external.mesJobOperationStart(operationId, type);
      } else {
        redirectUrl = path.to.external.mesJobOperation(operationId);
      }

      return {
        data: redirectUrl,
        error: null
      };
    }

    return {
      data: redirectUrl,
      error: null
    };
  } else if (kanban.data.replenishmentSystem === "Buy") {
    const existingPurchaseOrder = await client
      .from("purchaseOrder")
      .select("id")
      .eq("supplierId", kanban.data.supplierId!)
      .in("status", ["Planned", "Draft"])
      .eq("companyId", companyId)
      .maybeSingle();

    let purchaseOrderId = existingPurchaseOrder.data?.id;

    if (!purchaseOrderId) {
      const nextSequence = await getNextSequence(
        client,
        "purchaseOrder",
        companyId
      );
      if (nextSequence.error) {
        console.error(nextSequence.error);
        return {
          data: null,
          error: "Failed to get next purchase order sequence"
        };
      }

      const newPurchaseOrder = await upsertPurchaseOrder(client, {
        purchaseOrderId: nextSequence.data!,
        supplierId: kanban.data.supplierId!,
        status: "Draft",
        purchaseOrderType: "Purchase",
        companyId,
        createdBy: userId
      });

      if (newPurchaseOrder.error || !newPurchaseOrder.data?.[0]) {
        console.error(newPurchaseOrder.error);
        return {
          data: null,
          error: "Failed to create purchase order"
        };
      }

      purchaseOrderId = newPurchaseOrder.data[0].id;
    }

    const [item, supplierPart, inventory] = await Promise.all([
      client
        .from("item")
        .select(
          "name, readableIdWithRevision, type, unitOfMeasureCode, itemCost(unitCost), itemReplenishment(purchasingUnitOfMeasureCode, conversionFactor, leadTime)"
        )
        .eq("id", kanban.data.itemId!)
        .eq("companyId", companyId)
        .single(),
      client
        .from("supplierPart")
        .select("*")
        .eq("itemId", kanban.data.itemId!)
        .eq("companyId", companyId)
        .eq("supplierId", kanban.data.supplierId!)
        .maybeSingle(),
      client
        .from("pickMethod")
        .select("defaultShelfId")
        .eq("itemId", kanban.data.itemId!)
        .eq("companyId", companyId)
        .eq("locationId", kanban.data.locationId!)
        .maybeSingle()
    ]);

    const itemCost = item?.data?.itemCost?.[0];
    const itemReplenishment = item?.data?.itemReplenishment;

    if (item.error) {
      console.error(item.error);
      return {
        data: null,
        error: "Failed to get item"
      };
    }

    const createPurchaseOrderLine = await upsertPurchaseOrderLine(client, {
      purchaseOrderId: purchaseOrderId!,
      // @ts-expect-error
      purchaseOrderLineType: item.data?.type,
      itemId: kanban.data.itemId!,
      purchaseQuantity: kanban.data.quantity!,
      supplierUnitPrice:
        supplierPart?.data?.unitPrice ?? itemCost?.unitCost ?? 0,
      supplierShippingCost: 0,
      supplierTaxAmount: 0,
      exchangeRate: 1,
      setupPrice: 0,
      purchaseUnitOfMeasureCode: kanban.data.purchaseUnitOfMeasureCode!,
      inventoryUnitOfMeasureCode:
        item.data?.unitOfMeasureCode || kanban.data.purchaseUnitOfMeasureCode!,
      conversionFactor:
        kanban.data.conversionFactor ||
        itemReplenishment?.conversionFactor ||
        1,
      locationId: kanban.data.locationId!,
      shelfId:
        kanban.data.shelfId || inventory.data?.defaultShelfId || undefined,
      companyId,
      createdBy: userId
    });

    if (createPurchaseOrderLine.error) {
      console.error(createPurchaseOrderLine.error);
      return {
        data: null,
        error: "Failed to create purchase order line"
      };
    }

    return {
      data: path.to.purchaseOrder(purchaseOrderId!),
      error: null
    };
  } else {
    return {
      data: null,
      error: `${kanban.data.replenishmentSystem} is not supported`
    };
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw notFound("id not found");

  return await handleKanban({ client, companyId, userId, id });
}

export default function KanbanRedirectRoute() {
  const promise = useLoaderData<typeof loader>();

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Suspense fallback={<Loading className="size-8" isLoading />}>
        <Await resolve={promise}>
          {(resolvedPromise) => {
            if (resolvedPromise.error) {
              return <div>{resolvedPromise.error}</div>;
            }
            return <Redirect path={resolvedPromise?.data ?? ""} />;
          }}
        </Await>
      </Suspense>
    </div>
  );
}
