import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { scrapQuantityValidator } from "~/services/models";
import { insertScrapQuantity } from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(scrapQuantityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { trackedEntityId, trackingType, ...d } = validation.data;

  const serviceRole = getCarbonServiceRole();
  const insertScrap = await insertScrapQuantity(serviceRole, {
    ...d,
    companyId,
    createdBy: userId
  });

  if (insertScrap.error) {
    return data(
      {},
      await flash(
        request,
        error(insertScrap.error, "Failed to record scrap quantity")
      )
    );
  }

  const issue = await getCarbonServiceRole().functions.invoke("issue", {
    body: {
      id: validation.data.jobOperationId,
      type: "jobOperation",
      quantity: validation.data.quantity,
      companyId,
      userId
    },
    region: FunctionRegion.UsWest2
  });

  if (issue.error) {
    throw data(
      {},
      await flash(request, error(issue.error, "Failed to issue materials"))
    );
  }

  return data(
    {},
    await flash(request, success("Scrap quantity recorded successfully"))
  );
}
