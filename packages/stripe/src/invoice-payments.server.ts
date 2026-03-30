import { getAppUrl, STRIPE_SECRET_KEY } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Stripe } from "stripe";

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      // @ts-ignore
      apiVersion: "2025-06-30.basil",
      typescript: true
    })
  : null;

function requireStripe() {
  if (!stripe) throw new Error("Stripe is not initialized");
  return stripe;
}

/**
 * Get or create a Stripe Customer for an ERP customer.
 * This is separate from the platform subscription customers —
 * these are the print shop's own customers.
 */
export async function getOrCreateStripeCustomer(
  client: SupabaseClient<Database>,
  params: {
    customerId: string;
    companyId: string;
    email: string;
    name: string;
    userId: string;
  }
) {
  const s = requireStripe();

  // Check if mapping already exists
  const existing = await client
    .from("customerStripeAccount")
    .select("stripeCustomerId")
    .eq("customerId", params.customerId)
    .eq("companyId", params.companyId)
    .maybeSingle();

  if (existing.data?.stripeCustomerId) {
    return existing.data.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await s.customers.create({
    email: params.email,
    name: params.name,
    metadata: {
      erpCustomerId: params.customerId,
      companyId: params.companyId
    }
  });

  // Store mapping
  await client.from("customerStripeAccount").insert({
    customerId: params.customerId,
    stripeCustomerId: customer.id,
    companyId: params.companyId,
    createdBy: params.userId
  });

  return customer.id;
}

/**
 * Create a Stripe Checkout Session for a one-time invoice payment.
 * Automatically saves the card for future use via setup_future_usage.
 */
export async function createInvoiceCheckoutSession(params: {
  invoiceId: string;
  invoiceNumber: string;
  externalLinkId: string;
  amount: number; // in smallest currency unit (cents)
  currency: string;
  stripeCustomerId?: string;
  customerEmail?: string;
  companyId: string;
  companyName: string;
}) {
  const s = requireStripe();
  const appUrl = getAppUrl();

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: params.currency.toLowerCase(),
          product_data: {
            name: `Invoice ${params.invoiceNumber}`,
            description: `Payment to ${params.companyName}`
          },
          unit_amount: params.amount
        },
        quantity: 1
      }
    ],
    success_url: `${appUrl}/share/invoice/${params.externalLinkId}?payment=success`,
    cancel_url: `${appUrl}/share/invoice/${params.externalLinkId}?payment=cancelled`,
    metadata: {
      invoiceId: params.invoiceId,
      companyId: params.companyId,
      externalLinkId: params.externalLinkId,
      type: "invoice_payment"
    },
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        invoiceId: params.invoiceId,
        companyId: params.companyId,
        type: "invoice_payment"
      }
    }
  };

  if (params.stripeCustomerId) {
    sessionParams.customer = params.stripeCustomerId;
  } else if (params.customerEmail) {
    sessionParams.customer_email = params.customerEmail;
  }

  const session = await s.checkout.sessions.create(sessionParams);

  return {
    url: session.url,
    sessionId: session.id
  };
}

/**
 * Create a Stripe Checkout Session in "setup" mode for saving a card.
 * Redirects the customer to Stripe's hosted page — no client-side SDK needed.
 */
export async function createSetupCheckoutSession(params: {
  stripeCustomerId: string;
  externalLinkId: string;
  companyName: string;
}) {
  const s = requireStripe();
  const appUrl = getAppUrl();

  const session = await s.checkout.sessions.create({
    mode: "setup",
    customer: params.stripeCustomerId,
    payment_method_types: ["card"],
    success_url: `${appUrl}/share/add-card/${params.externalLinkId}?result=success`,
    cancel_url: `${appUrl}/share/add-card/${params.externalLinkId}?result=cancelled`,
    metadata: {
      type: "save_card",
      externalLinkId: params.externalLinkId
    }
  });

  return {
    url: session.url,
    sessionId: session.id
  };
}

/**
 * List saved payment methods for a Stripe customer.
 */
export async function listPaymentMethods(stripeCustomerId: string) {
  const s = requireStripe();

  const methods = await s.paymentMethods.list({
    customer: stripeCustomerId,
    type: "card"
  });

  return methods.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
    expMonth: pm.card?.exp_month ?? null,
    expYear: pm.card?.exp_year ?? null
  }));
}

/**
 * Charge a saved payment method for an invoice.
 */
export async function chargePaymentMethod(params: {
  stripeCustomerId: string;
  paymentMethodId: string;
  amount: number; // in smallest currency unit (cents)
  currency: string;
  invoiceId: string;
  companyId: string;
}) {
  const s = requireStripe();

  const paymentIntent = await s.paymentIntents.create({
    amount: params.amount,
    currency: params.currency.toLowerCase(),
    customer: params.stripeCustomerId,
    payment_method: params.paymentMethodId,
    off_session: true,
    confirm: true,
    metadata: {
      invoiceId: params.invoiceId,
      companyId: params.companyId,
      type: "invoice_payment"
    }
  });

  return paymentIntent;
}

/**
 * Detach a payment method from a customer.
 */
export async function detachPaymentMethod(paymentMethodId: string) {
  const s = requireStripe();
  await s.paymentMethods.detach(paymentMethodId);
}

/**
 * Construct and verify a Stripe webhook event.
 */
export function constructWebhookEvent(
  body: string,
  signature: string,
  secret: string
) {
  const s = requireStripe();
  return s.webhooks.constructEvent(body, signature, secret);
}
