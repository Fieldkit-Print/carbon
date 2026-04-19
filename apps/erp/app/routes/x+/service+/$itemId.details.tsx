import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner, VStack } from "@carbon/react";
import { Suspense } from "react";
import type { ActionFunctionArgs } from "react-router";
import { Await, redirect, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, ServiceSummary } from "~/modules/items";
import { serviceValidator, upsertService } from "~/modules/items";
import {
  ItemDocuments,
  ItemNotes,
  ItemRiskRegister
} from "~/modules/items/ui/Item";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(serviceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateService = await upsertService(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updateService.error) {
    throw redirect(
      path.to.service(itemId),
      await flash(
        request,
        error(updateService.error, "Failed to update service")
      )
    );
  }

  throw redirect(
    path.to.service(itemId),
    await flash(request, success("Updated service"))
  );
}

export default function ServiceDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const serviceData = useRouteData<{
    serviceSummary: ServiceSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.service(itemId));

  if (!serviceData) throw new Error("Could not find service data");
  const permissions = usePermissions();

  return (
    <VStack spacing={2} className="p-2">
      <ItemNotes
        id={serviceData.serviceSummary?.id ?? null}
        title={serviceData.serviceSummary?.name ?? ""}
        subTitle={serviceData.serviceSummary?.readableIdWithRevision ?? ""}
        notes={serviceData.serviceSummary?.notes as JSONContent}
      />
      {permissions.is("employee") && (
        <>
          <Suspense
            fallback={
              <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
                <Spinner className="h-10 w-10" />
              </div>
            }
          >
            <Await resolve={serviceData?.files}>
              {(resolvedFiles) => (
                <ItemDocuments
                  files={resolvedFiles}
                  itemId={itemId}
                  type="Service"
                />
              )}
            </Await>
          </Suspense>

          <ItemRiskRegister itemId={itemId} />
        </>
      )}
    </VStack>
  );
}
