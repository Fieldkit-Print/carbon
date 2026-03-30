import { STRIPE_WEBHOOK_SECRET } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { constructWebhookEvent } from "@carbon/stripe/invoice-payments.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recordInvoicePayment } from "~/modules/invoicing";

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return data({ error: "No signature" }, { status: 400 });
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return data({ error: "Webhook not configured" }, { status: 500 });
  }

  let event;
  try {
    event = constructWebhookEvent(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return data({ error: "Invalid signature" }, { status: 400 });
  }

  const serviceRole = getCarbonServiceRole();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const { invoiceId, companyId, type } = session.metadata ?? {};

      // Only handle invoice payments, not platform subscriptions
      if (type !== "invoice_payment" || !invoiceId || !companyId) {
        break;
      }

      const amountTotal = (session.amount_total ?? 0) / 100;

      await recordInvoicePayment(serviceRole, {
        invoiceId,
        amount: amountTotal,
        currency: session.currency ?? "usd",
        stripePaymentIntentId: (session.payment_intent as string) ?? "",
        stripeCheckoutSessionId: session.id,
        paidByEmail: session.customer_details?.email ?? undefined,
        companyId
      });

      // If a Stripe Customer was created/used, ensure mapping exists
      if (session.customer) {
        const invoice = await serviceRole
          .from("salesInvoice")
          .select("customerId")
          .eq("id", invoiceId)
          .single();

        if (invoice.data?.customerId) {
          // Upsert the customer-stripe mapping
          await serviceRole.from("customerStripeAccount").upsert(
            {
              customerId: invoice.data.customerId,
              stripeCustomerId: session.customer as string,
              companyId,
              createdBy: "system"
            },
            { onConflict: "customerId,companyId" }
          );
        }
      }

      break;
    }

    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object;
      const { invoiceId, companyId, type } = paymentIntent.metadata ?? {};

      // Handle off-session charges (saved card payments)
      if (type !== "invoice_payment" || !invoiceId || !companyId) {
        break;
      }

      // Check if already recorded (checkout flow records on session.completed)
      const existing = await serviceRole
        .from("invoicePayment")
        .select("id")
        .eq("stripePaymentIntentId", paymentIntent.id)
        .maybeSingle();

      if (!existing.data) {
        const amount = (paymentIntent.amount ?? 0) / 100;
        await recordInvoicePayment(serviceRole, {
          invoiceId,
          amount,
          currency: paymentIntent.currency ?? "usd",
          stripePaymentIntentId: paymentIntent.id,
          companyId
        });
      }

      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object;
      const { invoiceId, type } = paymentIntent.metadata ?? {};

      if (type !== "invoice_payment" || !invoiceId) {
        break;
      }

      console.error(
        `Payment failed for invoice ${invoiceId}:`,
        paymentIntent.last_payment_error?.message
      );
      break;
    }
  }

  return { success: true };
}
