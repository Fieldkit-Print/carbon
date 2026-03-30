import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createProofApproval, updateJobStatus } from "~/modules/production";
import { upsertExternalLink } from "~/modules/shared";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const formData = await request.formData();
  const type = String(formData.get("type"));

  switch (type) {
    case "send": {
      const { data } = await client
        .from("job")
        .select("modelUploadId")
        .eq("id", jobId)
        .single();

      const serviceRole = getCarbonServiceRole();

      // Create an external link for proof sharing
      const externalLink = await upsertExternalLink(serviceRole, {
        companyId,
        documentType: "ProofApproval",
        documentId: jobId
      });

      // Create proof approval record
      await createProofApproval(serviceRole, {
        jobId,
        companyId,
        requestedBy: userId,
        modelUploadId: data?.modelUploadId ?? null,
        externalLinkId: externalLink.data?.id
      });

      // Reset proofSkipped if it was previously set
      await client.from("job").update({ proofSkipped: false }).eq("id", jobId);

      // Set status to Awaiting Proof Approval
      await updateJobStatus(client, {
        id: jobId,
        status: "Awaiting Proof Approval",
        updatedBy: userId
      });

      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, success("Proof sent for approval"))
      );
    }

    case "skip": {
      await client.from("job").update({ proofSkipped: true }).eq("id", jobId);

      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, success("Proof approval skipped"))
      );
    }

    default:
      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, error(null, "Invalid action"))
      );
  }
}
