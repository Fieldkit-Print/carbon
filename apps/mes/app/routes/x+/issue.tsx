import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { issueValidator } from "~/services/models";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);

  if (validation.error) {
    return data({ error: validation.error }, { status: 400 });
  }

  const { jobOperationId, materialId, itemId, quantity, adjustmentType } =
    validation.data;

  const serviceRole = await getCarbonServiceRole();
  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      id: jobOperationId,
      type: "partToOperation",
      itemId,
      materialId,
      quantity,
      adjustmentType,
      companyId,
      userId
    },
    region: FunctionRegion.UsWest2
  });

  if (issue.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.operations,
      await flash(request, error(issue.error, "Failed to issue material"))
    );
  }

  throw redirect(requestReferrer(request) ?? path.to.operations);
}
