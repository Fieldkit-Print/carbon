import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { modelThumbnailTask } from "@carbon/jobs/trigger/model-thumbnail";
import { tasks } from "@trigger.dev/sdk";
import type { ActionFunctionArgs } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const modelId = formData.get("modelId") as string;
  const name = formData.get("name") as string;
  const modelPath = formData.get("modelPath") as string;
  const size = parseInt(formData.get("size") as string);
  const jobId = formData.get("jobId") as string;

  if (!modelId || !name || !modelPath || !jobId) {
    throw new Error("modelId, name, modelPath, and jobId are required");
  }

  const serviceRole = getCarbonServiceRole();

  const modelRecord = await serviceRole.from("modelUpload").insert({
    id: modelId,
    modelPath,
    name,
    size,
    companyId,
    createdBy: userId
  });

  if (modelRecord.error) {
    throw new Error("Failed to record upload: " + modelRecord.error.message);
  }

  await serviceRole
    .from("job")
    .update({ modelUploadId: modelId })
    .eq("id", jobId);

  await tasks.trigger<typeof modelThumbnailTask>("model-thumbnail", {
    companyId,
    modelId
  });

  return { success: true };
}
