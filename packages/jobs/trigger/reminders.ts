import { getAppUrl, NOVU_API_URL, NOVU_SECRET_KEY } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { InvoiceReminderEmail, QuoteReminderEmail, ProofReminderEmail } from "@carbon/documents/email";
import type { TriggerPayload } from "@carbon/notifications";
import {
  getSubscriberId,
  NotificationEvent,
  NotificationWorkflow,
  triggerBulk,
} from "@carbon/notifications";
import { Novu } from "@novu/node";
import { renderAsync } from "@react-email/components";
import { schedules } from "@trigger.dev/sdk";
import { sendEmailResendTask } from "./send-email-resend";

const serviceRole = getCarbonServiceRole();
const novu = new Novu(NOVU_SECRET_KEY!, {
  backendUrl: NOVU_API_URL,
});

const QUOTE_REMINDER_DAYS = [1, 2, 5] as const;
const MS_PER_DAY = 86400000;

function getReminderTier(daysSinceSent: number): "customer_1d" | "customer_2d" | "customer_5d" | null {
  if (daysSinceSent >= 5) return "customer_5d";
  if (daysSinceSent >= 2) return "customer_2d";
  if (daysSinceSent >= 1) return "customer_1d";
  return null;
}

export const reminders = schedules.task({
  id: "reminders",
  cron: "0 14 * * *",
  run: async () => {
    console.log(`🔔 Starting reminder tasks: ${new Date().toISOString()}`);

    try {
      await sendQuoteReminders();
    } catch (error) {
      console.error("Error in quote reminders:", error);
    }

    try {
      await sendProofApprovalReminders();
    } catch (error) {
      console.error("Error in proof approval reminders:", error);
    }

    try {
      await sendInvoiceReminders();
    } catch (error) {
      console.error("Error in invoice reminders:", error);
    }

    console.log(`🔔 Reminder tasks completed: ${new Date().toISOString()}`);
  },
});

async function sendQuoteReminders() {
  console.log("Checking for quotes needing reminders...");

  const appUrl = getAppUrl();
  const now = Date.now();

  // Fetch all sent quotes with customer contact info
  const { data: quotes, error: quotesError } = await serviceRole
    .from("quote")
    .select(
      "id, quoteId, companyId, completedDate, expirationDate, externalLinkId, salesPersonId, customerContactId, customerReference"
    )
    .eq("status", "Sent")
    .not("completedDate", "is", null)
    .not("externalLinkId", "is", null)
    .not("customerContactId", "is", null);

  if (quotesError) {
    console.error("Error fetching quotes:", quotesError);
    return;
  }

  if (!quotes?.length) {
    console.log("No sent quotes found needing reminders");
    return;
  }

  console.log(`Found ${quotes.length} sent quotes to check`);

  // Fetch existing reminder logs for these quotes
  const quoteIds = quotes.map((q) => q.id);
  const { data: existingLogs } = await serviceRole
    .from("reminderLog")
    .select("documentId, reminderType")
    .eq("documentType", "Quote")
    .in("documentId", quoteIds);

  const sentReminders = new Set(
    (existingLogs ?? []).map((l) => `${l.documentId}:${l.reminderType}`)
  );

  // Collect salesperson notification payloads
  const salespersonPayloads: TriggerPayload[] = [];

  // Check today's salesperson reminders already sent
  const twentyHoursAgo = new Date(now - 20 * 60 * 60 * 1000).toISOString();
  const { data: recentSalespersonLogs } = await serviceRole
    .from("reminderLog")
    .select("documentId")
    .eq("documentType", "Quote")
    .eq("reminderType", "salesperson")
    .gte("sentAt", twentyHoursAgo)
    .in("documentId", quoteIds);

  const recentSalespersonSet = new Set(
    (recentSalespersonLogs ?? []).map((l) => l.documentId)
  );

  for (const quote of quotes) {
    const daysSinceSent = Math.floor(
      (now - new Date(quote.completedDate!).getTime()) / MS_PER_DAY
    );

    const reminderType = getReminderTier(daysSinceSent);
    if (!reminderType) continue;

    // Skip if quote expires within 1 day
    if (quote.expirationDate) {
      const expiresIn =
        new Date(quote.expirationDate).getTime() - now;
      if (expiresIn < MS_PER_DAY) continue;
    }

    // Skip if this reminder tier already sent
    if (sentReminders.has(`${quote.id}:${reminderType}`)) {
      // Still check salesperson reminder even if customer already got this tier
    } else {
      // Resolve customer contact email
      try {
        const { data: customerContact } = await serviceRole
          .from("customerContact")
          .select(
            "contact(id, firstName, lastName, email)"
          )
          .eq("id", quote.customerContactId!)
          .single();

        const email = (customerContact?.contact as any)?.email;
        if (!email) {
          console.log(
            `No email for contact on quote ${quote.quoteId}, skipping`
          );
          continue;
        }

        // Get company info for email template
        const { data: company } = await serviceRole
          .from("companies")
          .select("*")
          .eq("id", quote.companyId)
          .single();

        if (!company) {
          console.log(`No company found for quote ${quote.quoteId}, skipping`);
          continue;
        }

        const digitalQuoteUrl = `${appUrl}/share/quote/${quote.externalLinkId}`;
        const firstName = (customerContact?.contact as any)?.firstName;

        const emailTemplate = QuoteReminderEmail({
          company,
          quoteId: quote.quoteId!,
          digitalQuoteUrl,
          expirationDate: quote.expirationDate,
          daysSinceSent,
          recipient: {
            email,
            firstName: firstName ?? undefined,
          },
          sender: { email: "", firstName: "", lastName: "" },
          locale: "en-US",
        });

        const html = await renderAsync(emailTemplate);
        const text = await renderAsync(emailTemplate, { plainText: true });

        await sendEmailResendTask.trigger({
          to: email,
          subject: `Reminder: Quote ${quote.quoteId}`,
          html,
          text,
          companyId: quote.companyId,
        });

        // Log the customer reminder
        await serviceRole.from("reminderLog").insert({
          companyId: quote.companyId,
          documentType: "Quote",
          documentId: quote.id,
          reminderType,
        });

        console.log(
          `Sent ${reminderType} reminder for quote ${quote.quoteId} to ${email}`
        );
      } catch (err) {
        console.error(
          `Error sending reminder for quote ${quote.quoteId}:`,
          err
        );
      }
    }

    // Salesperson in-app notification (daily, deduped)
    if (quote.salesPersonId && !recentSalespersonSet.has(quote.id)) {
      salespersonPayloads.push({
        workflow: NotificationWorkflow.Reminder,
        payload: {
          documentId: quote.id,
          event: NotificationEvent.QuoteReminderPending,
          recordId: quote.id,
          description: `Quote ${quote.quoteId} is awaiting customer response`,
        },
        user: {
          subscriberId: getSubscriberId({
            companyId: quote.companyId,
            userId: quote.salesPersonId,
          }),
        },
      });
    }
  }

  // Send salesperson notifications in bulk
  if (salespersonPayloads.length > 0) {
    console.log(
      `Triggering ${salespersonPayloads.length} salesperson quote reminders`
    );
    try {
      await triggerBulk(novu, salespersonPayloads);

      // Log salesperson reminders
      const salespersonLogs = salespersonPayloads.map((p) => ({
        companyId: p.payload.recordId
          ? quotes.find((q) => q.id === p.payload.recordId)?.companyId ?? ""
          : "",
        documentType: "Quote",
        documentId: p.payload.recordId,
        reminderType: "salesperson",
      }));

      await serviceRole.from("reminderLog").insert(salespersonLogs);
    } catch (err) {
      console.error("Error sending salesperson quote reminders:", err);
    }
  }
}

async function sendProofApprovalReminders() {
  console.log("Checking for pending proof approvals needing reminders...");

  const appUrl = getAppUrl();
  const now = Date.now();

  // Fetch pending proof approvals with job and sales order info
  const { data: proofs, error: proofsError } = await serviceRole
    .from("proofApproval")
    .select(
      "id, jobId, companyId, version, requestedAt, requestedBy, externalLinkId, job(id, jobId, name, salesOrderId)"
    )
    .eq("status", "Pending")
    .not("externalLinkId", "is", null);

  if (proofsError) {
    console.error("Error fetching proof approvals:", proofsError);
    return;
  }

  if (!proofs?.length) {
    console.log("No pending proof approvals found");
    return;
  }

  console.log(`Found ${proofs.length} pending proof approvals to check`);

  // Check for recent customer daily reminders (within 20 hours)
  const proofIds = proofs.map((p) => p.id);
  const twentyHoursAgo = new Date(now - 20 * 60 * 60 * 1000).toISOString();

  const { data: recentCustomerLogs } = await serviceRole
    .from("reminderLog")
    .select("documentId")
    .eq("documentType", "ProofApproval")
    .eq("reminderType", "customer_daily")
    .gte("sentAt", twentyHoursAgo)
    .in("documentId", proofIds);

  const recentCustomerSet = new Set(
    (recentCustomerLogs ?? []).map((l) => l.documentId)
  );

  const { data: recentSalespersonLogs } = await serviceRole
    .from("reminderLog")
    .select("documentId")
    .eq("documentType", "ProofApproval")
    .eq("reminderType", "salesperson")
    .gte("sentAt", twentyHoursAgo)
    .in("documentId", proofIds);

  const recentSalespersonSet = new Set(
    (recentSalespersonLogs ?? []).map((l) => l.documentId)
  );

  const salespersonPayloads: TriggerPayload[] = [];

  for (const proof of proofs) {
    const daysSinceRequested = Math.floor(
      (now - new Date(proof.requestedAt).getTime()) / MS_PER_DAY
    );

    // No same-day reminders
    if (daysSinceRequested < 1) continue;

    const job = proof.job as any;
    if (!job?.salesOrderId) {
      console.log(
        `Proof ${proof.id} has no sales order, skipping customer reminder`
      );
      // Still send salesperson reminder
    } else if (!recentCustomerSet.has(proof.id)) {
      try {
        // Resolve customer contact via sales order
        const { data: salesOrder } = await serviceRole
          .from("salesOrder")
          .select("customerContactId")
          .eq("id", job.salesOrderId)
          .single();

        if (!salesOrder?.customerContactId) {
          console.log(
            `No customer contact on sales order for proof ${proof.id}, skipping`
          );
        } else {
          const { data: customerContact } = await serviceRole
            .from("customerContact")
            .select("contact(id, firstName, lastName, email)")
            .eq("id", salesOrder.customerContactId)
            .single();

          const email = (customerContact?.contact as any)?.email;
          if (!email) {
            console.log(
              `No email for contact on proof ${proof.id}, skipping`
            );
          } else {
            // Get company info
            const { data: company } = await serviceRole
              .from("companies")
              .select("*")
              .eq("id", proof.companyId)
              .single();

            if (company) {
              const proofUrl = `${appUrl}/share/proof/${proof.externalLinkId}`;
              const firstName = (customerContact?.contact as any)?.firstName;

              const emailTemplate = ProofReminderEmail({
                company,
                jobName: job.name ?? job.jobId ?? "Job",
                proofUrl,
                version: proof.version,
                recipient: {
                  email,
                  firstName: firstName ?? undefined,
                },
                sender: { email: "", firstName: "", lastName: "" },
                locale: "en-US",
              });

              const html = await renderAsync(emailTemplate);
              const text = await renderAsync(emailTemplate, {
                plainText: true,
              });

              await sendEmailResendTask.trigger({
                to: email,
                subject: `Reminder: Proof awaiting approval — ${job.name ?? job.jobId}`,
                html,
                text,
                companyId: proof.companyId,
              });

              await serviceRole.from("reminderLog").insert({
                companyId: proof.companyId,
                documentType: "ProofApproval",
                documentId: proof.id,
                reminderType: "customer_daily",
              });

              console.log(
                `Sent daily proof reminder for ${job.jobId} to ${email}`
              );
            }
          }
        }
      } catch (err) {
        console.error(
          `Error sending proof reminder for ${proof.id}:`,
          err
        );
      }
    }

    // Salesperson in-app notification
    if (proof.requestedBy && !recentSalespersonSet.has(proof.id)) {
      const jobLabel = job?.jobId ?? "Job";
      salespersonPayloads.push({
        workflow: NotificationWorkflow.Reminder,
        payload: {
          documentId: proof.id,
          event: NotificationEvent.ProofReminderPending,
          recordId: proof.id,
          description: `Proof for ${jobLabel} is awaiting customer approval`,
        },
        user: {
          subscriberId: getSubscriberId({
            companyId: proof.companyId,
            userId: proof.requestedBy,
          }),
        },
      });
    }
  }

  // Send salesperson notifications in bulk
  if (salespersonPayloads.length > 0) {
    console.log(
      `Triggering ${salespersonPayloads.length} salesperson proof reminders`
    );
    try {
      await triggerBulk(novu, salespersonPayloads);

      const salespersonLogs = salespersonPayloads.map((p) => ({
        companyId:
          proofs.find((pr) => pr.id === p.payload.recordId)?.companyId ?? "",
        documentType: "ProofApproval",
        documentId: p.payload.recordId,
        reminderType: "salesperson",
      }));

      await serviceRole.from("reminderLog").insert(salespersonLogs);
    } catch (err) {
      console.error("Error sending salesperson proof reminders:", err);
    }
  }
}

async function sendInvoiceReminders() {
  console.log("Checking for unpaid invoices needing reminders...");

  const appUrl = getAppUrl();
  const now = Date.now();

  // Fetch submitted/overdue/partially paid invoices with external links
  const { data: invoices, error: invoicesError } = await serviceRole
    .from("salesInvoice")
    .select(
      "id, invoiceId, companyId, status, dateDue, dateIssued, totalAmount, balance, externalLinkId, invoiceCustomerContactId, assignee, createdBy"
    )
    .in("status", ["Submitted", "Overdue", "Partially Paid"])
    .not("externalLinkId", "is", null)
    .not("invoiceCustomerContactId", "is", null);

  if (invoicesError) {
    console.error("Error fetching invoices:", invoicesError);
    return;
  }

  if (!invoices?.length) {
    console.log("No unpaid invoices found needing reminders");
    return;
  }

  console.log(`Found ${invoices.length} unpaid invoices to check`);

  const invoiceIds = invoices.map((i) => i.id);
  const twentyHoursAgo = new Date(now - 20 * 60 * 60 * 1000).toISOString();

  // Check recent customer reminders
  const { data: recentCustomerLogs } = await serviceRole
    .from("reminderLog")
    .select("documentId")
    .eq("documentType", "SalesInvoice")
    .eq("reminderType", "customer_daily")
    .gte("sentAt", twentyHoursAgo)
    .in("documentId", invoiceIds);

  const recentCustomerSet = new Set(
    (recentCustomerLogs ?? []).map((l) => l.documentId)
  );

  // Check recent salesperson reminders
  const { data: recentSalespersonLogs } = await serviceRole
    .from("reminderLog")
    .select("documentId")
    .eq("documentType", "SalesInvoice")
    .eq("reminderType", "salesperson")
    .gte("sentAt", twentyHoursAgo)
    .in("documentId", invoiceIds);

  const recentSalespersonSet = new Set(
    (recentSalespersonLogs ?? []).map((l) => l.documentId)
  );

  const salespersonPayloads: TriggerPayload[] = [];

  for (const invoice of invoices) {
    const issuedAt = invoice.dateIssued ?? invoice.dateDue;
    if (!issuedAt) continue;

    const daysSinceIssued = Math.floor(
      (now - new Date(issuedAt).getTime()) / MS_PER_DAY
    );

    // No same-day reminders
    if (daysSinceIssued < 1) continue;

    const isOverdue =
      invoice.status === "Overdue" ||
      (invoice.dateDue && new Date(invoice.dateDue).getTime() < now);

    // Customer email (daily, deduplicated)
    if (!recentCustomerSet.has(invoice.id)) {
      try {
        const { data: customerContact } = await serviceRole
          .from("customerContact")
          .select("contact(id, firstName, lastName, email)")
          .eq("id", invoice.invoiceCustomerContactId!)
          .single();

        const email = (customerContact?.contact as any)?.email;
        if (!email) {
          console.log(
            `No email for contact on invoice ${invoice.invoiceId}, skipping`
          );
        } else {
          const { data: company } = await serviceRole
            .from("companies")
            .select("*")
            .eq("id", invoice.companyId)
            .single();

          if (company) {
            const digitalInvoiceUrl = `${appUrl}/share/invoice/${invoice.externalLinkId}`;
            const firstName = (customerContact?.contact as any)?.firstName;

            const emailTemplate = InvoiceReminderEmail({
              company,
              invoiceId: invoice.invoiceId!,
              digitalInvoiceUrl,
              dateDue: invoice.dateDue,
              totalAmount: invoice.totalAmount
                ? Number(invoice.totalAmount)
                : undefined,
              balance: invoice.balance
                ? Number(invoice.balance)
                : undefined,
              isOverdue,
              recipient: {
                email,
                firstName: firstName ?? undefined,
              },
              sender: { email: "", firstName: "", lastName: "" },
              locale: "en-US",
            });

            const html = await renderAsync(emailTemplate);
            const text = await renderAsync(emailTemplate, {
              plainText: true,
            });

            await sendEmailResendTask.trigger({
              to: email,
              subject: isOverdue
                ? `Overdue: Invoice ${invoice.invoiceId}`
                : `Reminder: Invoice ${invoice.invoiceId}`,
              html,
              text,
              companyId: invoice.companyId,
            });

            await serviceRole.from("reminderLog").insert({
              companyId: invoice.companyId,
              documentType: "SalesInvoice",
              documentId: invoice.id,
              reminderType: "customer_daily",
            });

            console.log(
              `Sent ${isOverdue ? "overdue" : "reminder"} for invoice ${invoice.invoiceId} to ${email}`
            );
          }
        }
      } catch (err) {
        console.error(
          `Error sending invoice reminder for ${invoice.invoiceId}:`,
          err
        );
      }
    }

    // Salesperson/assignee in-app notification
    const notifyUserId = invoice.assignee ?? invoice.createdBy;
    if (notifyUserId && !recentSalespersonSet.has(invoice.id)) {
      const label = isOverdue ? "is overdue" : "is awaiting payment";
      salespersonPayloads.push({
        workflow: NotificationWorkflow.Reminder,
        payload: {
          documentId: invoice.id,
          event: NotificationEvent.InvoiceReminderPending,
          recordId: invoice.id,
          description: `Invoice ${invoice.invoiceId} ${label}`,
        },
        user: {
          subscriberId: getSubscriberId({
            companyId: invoice.companyId,
            userId: notifyUserId,
          }),
        },
      });
    }
  }

  // Send salesperson notifications in bulk
  if (salespersonPayloads.length > 0) {
    console.log(
      `Triggering ${salespersonPayloads.length} salesperson invoice reminders`
    );
    try {
      await triggerBulk(novu, salespersonPayloads);

      const salespersonLogs = salespersonPayloads.map((p) => ({
        companyId:
          invoices.find((i) => i.id === p.payload.recordId)?.companyId ?? "",
        documentType: "SalesInvoice",
        documentId: p.payload.recordId,
        reminderType: "salesperson",
      }));

      await serviceRole.from("reminderLog").insert(salespersonLogs);
    } catch (err) {
      console.error("Error sending salesperson invoice reminders:", err);
    }
  }
}
