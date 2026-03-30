import { assertIsPost, notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { createInvoiceCheckoutSession } from "@carbon/stripe/invoice-payments.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getCustomerStripeAccount,
  getSalesInvoiceByExternalId
} from "~/modules/invoicing";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const type = String(formData.get("type"));

  const serviceRole = getCarbonServiceRole();
  const invoice = await getSalesInvoiceByExternalId(serviceRole, id);

  if (invoice.error || !invoice.data) {
    return { success: false, message: "Invoice not found" };
  }

  if (invoice.data.status === "Paid") {
    return { success: false, message: "Invoice is already paid" };
  }

  const company = await serviceRole
    .from("company")
    .select("name")
    .eq("id", invoice.data.companyId)
    .single();

  switch (type) {
    case "checkout": {
      const balanceDue = invoice.data.balance ?? 0;
      if (balanceDue <= 0) {
        return { success: false, message: "No balance due" };
      }

      // Get Stripe customer if exists
      let stripeCustomerId: string | undefined;
      if (invoice.data.customerId) {
        const stripeAccount = await getCustomerStripeAccount(
          serviceRole,
          invoice.data.customerId,
          invoice.data.companyId
        );
        stripeCustomerId = stripeAccount.data?.stripeCustomerId ?? undefined;
      }

      // Get customer email for Stripe
      let customerEmail: string | undefined;
      if (invoice.data.customerId && !stripeCustomerId) {
        const customerContact = await serviceRole
          .from("customerContact")
          .select("contact(email)")
          .eq("customerId", invoice.data.customerId)
          .limit(1)
          .maybeSingle();

        customerEmail =
          (customerContact.data as any)?.contact?.email ?? undefined;
      }

      // Amount in cents
      const amountInCents = Math.round(balanceDue * 100);

      const session = await createInvoiceCheckoutSession({
        invoiceId: invoice.data.id,
        invoiceNumber: invoice.data.invoiceId ?? invoice.data.id,
        externalLinkId: id,
        amount: amountInCents,
        currency: invoice.data.currencyCode ?? "USD",
        stripeCustomerId,
        customerEmail,
        companyId: invoice.data.companyId,
        companyName: company.data?.name ?? "Invoice"
      });

      if (session.url) {
        throw redirect(session.url);
      }

      return { success: false, message: "Failed to create checkout session" };
    }

    default:
      return { success: false, message: "Invalid action type" };
  }
}
