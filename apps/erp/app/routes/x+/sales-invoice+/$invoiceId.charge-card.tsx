import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  chargePaymentMethod,
  listPaymentMethods
} from "@carbon/stripe/invoice-payments.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getCustomerStripeAccount,
  getSalesInvoice,
  getSalesInvoiceShipment
} from "~/modules/invoicing";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) return { paymentMethods: [] };

  const invoice = await getSalesInvoice(client, invoiceId);
  if (invoice.error || !invoice.data?.customerId) {
    return { paymentMethods: [] };
  }

  const serviceRole = getCarbonServiceRole();
  const stripeAccount = await getCustomerStripeAccount(
    serviceRole,
    invoice.data.customerId,
    invoice.data.companyId
  );

  if (!stripeAccount.data?.stripeCustomerId) {
    return { paymentMethods: [] };
  }

  const paymentMethods = await listPaymentMethods(
    stripeAccount.data.stripeCustomerId
  );

  return { paymentMethods };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) return { success: false, message: "Invoice ID is required" };

  const formData = await request.formData();
  const paymentMethodId = String(formData.get("paymentMethodId"));
  if (!paymentMethodId)
    return { success: false, message: "Payment method is required" };

  const serviceRole = getCarbonServiceRole();
  const [invoice, shipment] = await Promise.all([
    getSalesInvoice(client, invoiceId),
    getSalesInvoiceShipment(client, invoiceId)
  ]);

  if (invoice.error || !invoice.data) {
    return { success: false, message: "Invoice not found" };
  }

  if (invoice.data.status === "Paid") {
    return { success: false, message: "Invoice is already paid" };
  }

  if (!invoice.data.customerId) {
    return { success: false, message: "Invoice has no customer" };
  }

  const stripeAccount = await getCustomerStripeAccount(
    serviceRole,
    invoice.data.customerId,
    invoice.data.companyId
  );

  if (!stripeAccount.data?.stripeCustomerId) {
    return { success: false, message: "Customer has no Stripe account" };
  }

  // balance only tracks line item subtotal; include shipping + tax
  const shippingCost = shipment.data?.shippingCost ?? 0;
  const taxAmount = invoice.data.totalTax ?? 0;
  const balanceDue = (invoice.data.balance ?? 0) + shippingCost + taxAmount;

  if (balanceDue <= 0) {
    return { success: false, message: "No balance due" };
  }

  const amountInCents = Math.round(balanceDue * 100);

  try {
    await chargePaymentMethod({
      stripeCustomerId: stripeAccount.data.stripeCustomerId,
      paymentMethodId,
      amount: amountInCents,
      currency: invoice.data.currencyCode ?? "USD",
      invoiceId: invoice.data.id,
      companyId: invoice.data.companyId
    });

    return { success: true, message: "Payment initiated successfully" };
  } catch (e: any) {
    return {
      success: false,
      message: e.message ?? "Payment failed"
    };
  }
}
