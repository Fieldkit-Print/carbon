import { assertIsPost, notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { notifyTask } from "@carbon/jobs/trigger/notify";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import {
  getProofApprovalByExternalId,
  updateJobStatus,
  updateProofApprovalStatus
} from "~/modules/production";
import { tasks } from "~/utils/tasks";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const type = String(formData.get("type"));

  const serviceRole = getCarbonServiceRole();
  const proof = await getProofApprovalByExternalId(serviceRole, id);

  if (proof.error || !proof.data) {
    console.error("Proof approval not found", proof.error);
    return { success: false, message: "Proof approval not found" };
  }

  switch (type) {
    case "approve": {
      const decidedBy = String(formData.get("decidedBy"));
      const decidedByEmail = String(formData.get("decidedByEmail"));
      const decisionNotes = formData.get("decisionNotes") as string | null;

      const update = await updateProofApprovalStatus(serviceRole, {
        id: proof.data.id,
        status: "Approved",
        decidedBy,
        decidedByEmail,
        decisionNotes: decisionNotes ?? undefined
      });

      if (update.error) {
        console.error("Failed to approve proof", update.error);
        return { success: false, message: "Failed to approve proof" };
      }

      // Transition the job to Ready
      const jobUpdate = await updateJobStatus(serviceRole, {
        id: proof.data.jobId,
        status: "Ready",
        updatedBy: decidedByEmail
      });

      if (jobUpdate.error) {
        console.error("Failed to update job status", jobUpdate.error);
      }

      // Trigger notification
      try {
        await tasks.trigger<typeof notifyTask>("notify", {
          companyId: proof.data.companyId,
          documentId: proof.data.jobId,
          event: NotificationEvent.ProofApprovalResponse,
          recipient: {
            type: "user",
            userId: proof.data.requestedBy
          }
        });
      } catch (err) {
        console.error("Failed to trigger notification", err);
      }

      return { success: true, message: "Proof approved!" };
    }

    case "reject": {
      const decidedBy = String(formData.get("decidedBy"));
      const decidedByEmail = String(formData.get("decidedByEmail"));
      const decisionNotes = formData.get("decisionNotes") as string | null;

      const update = await updateProofApprovalStatus(serviceRole, {
        id: proof.data.id,
        status: "Rejected",
        decidedBy,
        decidedByEmail,
        decisionNotes: decisionNotes ?? undefined
      });

      if (update.error) {
        console.error("Failed to reject proof", update.error);
        return { success: false, message: "Failed to reject proof" };
      }

      // Trigger notification
      try {
        await tasks.trigger<typeof notifyTask>("notify", {
          companyId: proof.data.companyId,
          documentId: proof.data.jobId,
          event: NotificationEvent.ProofApprovalResponse,
          recipient: {
            type: "user",
            userId: proof.data.requestedBy
          }
        });
      } catch (err) {
        console.error("Failed to trigger notification", err);
      }

      return { success: true, message: "Proof rejected" };
    }

    default:
      return { success: false, message: "Invalid type" };
  }
}
