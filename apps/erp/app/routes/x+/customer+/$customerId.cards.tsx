import { assertIsPost, error, getAppUrl, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { sendEmailResendTask } from "@carbon/jobs/trigger/send-email-resend";
import {
  detachPaymentMethod,
  getOrCreateStripeCustomer,
  listPaymentMethods
} from "@carbon/stripe/invoice-payments.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { getCustomerStripeAccount } from "~/modules/invoicing";
import { getCustomer } from "~/modules/sales";
import { CustomerCardsOnFile } from "~/modules/sales/ui/Customer";
import { upsertExternalLink } from "~/modules/shared";
import { getUser } from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { tasks } from "~/utils/tasks";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const { companyId } = await requirePermissions(request, {});

  const stripeAccount = await getCustomerStripeAccount(
    client,
    customerId,
    companyId
  );

  let paymentMethods: {
    id: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
  }[] = [];

  if (stripeAccount.data?.stripeCustomerId) {
    try {
      paymentMethods = await listPaymentMethods(
        stripeAccount.data.stripeCustomerId
      );
    } catch {
      // Stripe not configured or error fetching
    }
  }

  return {
    paymentMethods,
    hasStripeCustomer: !!stripeAccount.data?.stripeCustomerId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const formData = await request.formData();
  const type = String(formData.get("type"));

  switch (type) {
    case "detach": {
      const paymentMethodId = String(formData.get("paymentMethodId"));
      try {
        await detachPaymentMethod(paymentMethodId);
        throw redirect(
          path.to.customerCards(customerId),
          await flash(request, success("Card removed"))
        );
      } catch (err) {
        if (err instanceof Response) throw err;
        throw redirect(
          path.to.customerCards(customerId),
          await flash(request, error(err, "Failed to remove card"))
        );
      }
    }

    case "sendAddCardLink": {
      const serviceRole = getCarbonServiceRole();

      // Get customer details
      const customer = await getCustomer(client, customerId);
      if (!customer.data) {
        throw redirect(
          path.to.customerCards(customerId),
          await flash(request, error(null, "Customer not found"))
        );
      }

      // Get primary contact for email
      const contacts = await serviceRole
        .from("customerContact")
        .select("contact(id, email, firstName, lastName)")
        .eq("customerId", customerId)
        .limit(1)
        .maybeSingle();

      const contactEmail = (contacts.data as any)?.contact?.email;
      if (!contactEmail) {
        throw redirect(
          path.to.customerCards(customerId),
          await flash(
            request,
            error(null, "No contact email found for this customer")
          )
        );
      }

      // Ensure Stripe customer exists so card can be saved
      await getOrCreateStripeCustomer(serviceRole, {
        customerId,
        companyId,
        email: contactEmail,
        name: customer.data.name,
        userId
      });

      // Create external link for add-card page
      const externalLink = await upsertExternalLink(serviceRole, {
        documentType: "PaymentMethod",
        documentId: customerId,
        customerId,
        companyId
      });

      if (!externalLink.data) {
        throw redirect(
          path.to.customerCards(customerId),
          await flash(request, error(null, "Failed to create add-card link"))
        );
      }

      const addCardUrl = `${getAppUrl()}/share/add-card/${externalLink.data.id}`;

      // Send email with add-card link
      const sender = await getUser(serviceRole, userId);
      const contactFirstName = (contacts.data as any)?.contact?.firstName ?? "";

      try {
        await tasks.trigger<typeof sendEmailResendTask>("send-email-resend", {
          to: [contactEmail],
          from: sender.data?.email,
          subject: `Add your payment card on file`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Add Your Card on File</h2>
              <p>Hi${contactFirstName ? ` ${contactFirstName}` : ""},</p>
              <p>We'd like to securely save your payment card for future invoices. Click the button below to add your card:</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${addCardUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-block;">
                  Add Card on File
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">Your card information is securely handled by Stripe. We never see or store your full card number.</p>
            </div>
          `,
          text: `Add your payment card on file: ${addCardUrl}`,
          companyId
        });
      } catch {
        // Email send failed but link was created
      }

      throw redirect(
        path.to.customerCards(customerId),
        await flash(request, success("Add card link sent to customer"))
      );
    }

    default:
      throw redirect(
        path.to.customerCards(customerId),
        await flash(request, error(null, "Invalid action"))
      );
  }
}

export default function CustomerCardsRoute() {
  const { paymentMethods, hasStripeCustomer } = useLoaderData<typeof loader>();
  const { customerId } = useParams();

  return (
    <CustomerCardsOnFile
      paymentMethods={paymentMethods}
      customerId={customerId ?? ""}
      hasStripeCustomer={hasStripeCustomer}
    />
  );
}
