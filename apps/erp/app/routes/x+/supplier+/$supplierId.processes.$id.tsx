import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { SupplierProcess } from "~/modules/purchasing";
import {
  supplierProcessValidator,
  upsertSupplierProcess
} from "~/modules/purchasing";
import SupplierProcessForm from "~/modules/purchasing/ui/Supplier/SupplierProcessForm";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { supplierProcessesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [priceBreaksResult, addonsResult] = await Promise.all([
    client
      .from("supplierProcessPrice")
      .select("quantity, unitPrice")
      .eq("supplierProcessId", id)
      .order("quantity", { ascending: true }),
    client
      .from("supplierProcessAddon")
      .select("name, amount, feeType")
      .eq("supplierProcessId", id)
  ]);

  return {
    priceBreaks: priceBreaksResult.data ?? [],
    addons: addonsResult.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();

  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("Could not find id");

  const createSupplierProcess = await upsertSupplierProcess(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createSupplierProcess.error) {
    throw redirect(
      path.to.supplierProcesses(supplierId),
      await flash(
        request,
        error(createSupplierProcess.error, "Failed to update supplier process")
      )
    );
  }

  // Price breaks: delete + insert
  const priceBreaksRaw = formData.get("priceBreaks");
  if (priceBreaksRaw) {
    const priceBreaks = JSON.parse(priceBreaksRaw as string) as {
      quantity: number;
      unitPrice: number;
    }[];
    const db = getDatabaseClient();
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("supplierProcessPrice")
        .where("supplierProcessId", "=", id)
        .execute();
      if (priceBreaks.length > 0) {
        await trx
          .insertInto("supplierProcessPrice")
          .values(
            priceBreaks.map((pb) => ({
              supplierProcessId: id,
              quantity: pb.quantity,
              unitPrice: pb.unitPrice,
              companyId,
              createdBy: userId,
              updatedBy: userId
            }))
          )
          .execute();
      }
    });
  }

  // Addons: delete + insert
  const addonsRaw = formData.get("addons");
  if (addonsRaw) {
    const addons = JSON.parse(addonsRaw as string) as {
      name: string;
      amount: number;
      feeType: string;
    }[];
    const db = getDatabaseClient();
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("supplierProcessAddon")
        .where("supplierProcessId", "=", id)
        .execute();
      if (addons.length > 0) {
        await trx
          .insertInto("supplierProcessAddon")
          .values(
            addons.map((a) => ({
              supplierProcessId: id,
              name: a.name,
              amount: a.amount,
              feeType: a.feeType,
              companyId,
              createdBy: userId
            }))
          )
          .execute();
      }
    });
  }

  return redirect(path.to.supplierProcesses(supplierId));
}

export async function clientAction({
  request,
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const formData = await request.clone().formData(); // if we. don't clone it we can't access it in the action
  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  if (validation.data.processId) {
    window.clientCache?.setQueryData(
      supplierProcessesQuery(validation.data.processId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function SupplierProcessRoute() {
  const { supplierId, id } = useParams();
  if (!supplierId) throw new Error("Could not find supplier id");
  if (!id) throw new Error("Could not find id");

  const { priceBreaks, addons } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ processes: SupplierProcess[] }>(
    path.to.supplierProcesses(supplierId)
  );

  const process = routeData?.processes.find((process) => process.id === id);
  if (!process) throw new Error("Could not find process");

  const navigate = useNavigate();

  const initialValues = {
    id: process.id ?? undefined,
    supplierId: process.supplierId ?? "",
    processId: process.processId ?? "",
    minimumCost: process.minimumCost ?? 0,
    setupCost: process.setupCost ?? 0,
    leadTime: process.leadTime ?? 0,
    isPreferred: process.isPreferred ?? false
  };

  return (
    <SupplierProcessForm
      initialValues={initialValues}
      priceBreaks={priceBreaks}
      addons={
        addons as {
          name: string;
          amount: number;
          feeType: "flat" | "per-piece";
        }[]
      }
      onClose={() => navigate(-1)}
    />
  );
}
