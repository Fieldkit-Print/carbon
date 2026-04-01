import { assertIsPost, error, getAppUrl, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { ProofApprovalEmail } from "@carbon/documents/email";
import type { sendEmailResendTask } from "@carbon/jobs/trigger/send-email-resend";
import { renderAsync } from "@react-email/components";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createProofApproval, updateJobStatus } from "~/modules/production";
import { getCustomerContact } from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { upsertExternalLink } from "~/modules/shared";
import { getUser } from "~/modules/users/users.server";
import { path, requestReferrer } from "~/utils/path";
import { tasks } from "~/utils/tasks";

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
      const { data: job } = await client
        .from("job")
        .select("modelUploadId, name, salesOrderId, customerId")
        .eq("id", jobId)
        .single();

      const serviceRole = getCarbonServiceRole();

      // Find or create an external link for proof sharing
      const existingLink = await serviceRole
        .from("externalLink")
        .select("id")
        .eq("documentType", "ProofApproval")
        .eq("documentId", jobId)
        .eq("companyId", companyId)
        .maybeSingle();

      const externalLink = existingLink.data
        ? existingLink
        : await upsertExternalLink(serviceRole, {
            companyId,
            documentType: "ProofApproval",
            documentId: jobId
          });

      // Create proof approval record
      const proofApproval = await createProofApproval(serviceRole, {
        jobId,
        companyId,
        requestedBy: userId,
        modelUploadId: job?.modelUploadId ?? null,
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

      // Send email to contacts
      if (externalLink.data?.id && job?.salesOrderId) {
        try {
          const { data: salesOrder } = await client
            .from("salesOrder")
            .select("customerContactId, customerId")
            .eq("id", job.salesOrderId)
            .single();

          // Collect contact emails and first contact info
          const emailAddresses: string[] = [];
          let recipientFirstName: string | undefined;

          // Get SO contact email
          if (salesOrder?.customerContactId) {
            const soContact = await getCustomerContact(
              client,
              salesOrder.customerContactId
            );
            if (soContact.data?.contact?.email) {
              emailAddresses.push(soContact.data.contact.email);
              recipientFirstName =
                soContact.data.contact.firstName ?? undefined;
            }
          }

          // Get customer's sales contact email (if different)
          const customerId = salesOrder?.customerId ?? job?.customerId;
          if (customerId) {
            const { data: customer } = await client
              .from("customer")
              .select("salesContactId")
              .eq("id", customerId)
              .single();

            if (
              customer?.salesContactId &&
              customer.salesContactId !== salesOrder?.customerContactId
            ) {
              const salesContact = await getCustomerContact(
                client,
                customer.salesContactId
              );
              if (salesContact.data?.contact?.email) {
                emailAddresses.push(salesContact.data.contact.email);
              }
            }
          }

          if (emailAddresses.length > 0) {
            const [company, user] = await Promise.all([
              getCompany(client, companyId),
              getUser(client, userId)
            ]);

            if (company.data && user.data) {
              const proofUrl = `${getAppUrl()}/share/proof/${externalLink.data.id}`;
              const jobName = job?.name ?? "Job";

              const emailTemplate = ProofApprovalEmail({
                company: company.data,
                jobName,
                proofUrl,
                version: proofApproval.data?.version ?? 1,
                recipient: {
                  firstName: recipientFirstName,
                  email: emailAddresses[0]
                },
                sender: {
                  email: user.data.email,
                  firstName: user.data.firstName,
                  lastName: user.data.lastName
                },
                locale: "en-US"
              });

              const html = await renderAsync(emailTemplate);
              const text = await renderAsync(emailTemplate, {
                plainText: true
              });

              const uniqueEmails = [...new Set(emailAddresses)];

              await tasks.trigger<typeof sendEmailResendTask>(
                "send-email-resend",
                {
                  to: uniqueEmails,
                  from: user.data.email,
                  subject: `Proof Approval — ${jobName}`,
                  html,
                  text,
                  companyId
                }
              );
            }
          }
        } catch (emailErr) {
          console.error("Failed to send proof email:", emailErr);
          // Don't fail the whole action if email fails — the proof was created
        }
      }

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
