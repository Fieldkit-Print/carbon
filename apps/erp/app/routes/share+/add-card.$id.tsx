import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Button,
  Card,
  CardContent,
  Heading,
  HStack,
  VStack
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import {
  createSetupCheckoutSession,
  getOrCreateStripeCustomer
} from "@carbon/stripe/invoice-payments.server";
import { LuCheck, LuCreditCard, LuX } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { getExternalLink } from "~/modules/shared";

export const meta = () => {
  return [{ title: "Add Card on File" }];
};

enum PageState {
  Ready,
  Success,
  Cancelled,
  NotFound
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) return { state: PageState.NotFound, data: null };

  const serviceRole = getCarbonServiceRole();
  const externalLink = await getExternalLink(serviceRole, id);

  if (externalLink.error || !externalLink.data) {
    return { state: PageState.NotFound, data: null };
  }

  if (externalLink.data.documentType !== "PaymentMethod") {
    return { state: PageState.NotFound, data: null };
  }

  const url = new URL(request.url);
  const result = url.searchParams.get("result");

  if (result === "success") {
    return { state: PageState.Success, data: null };
  }

  if (result === "cancelled") {
    return {
      state: PageState.Cancelled,
      data: { externalLinkId: id }
    };
  }

  // Get company info for display
  const company = await serviceRole
    .from("company")
    .select("name, logoLightIcon")
    .eq("id", externalLink.data.companyId)
    .single();

  return {
    state: PageState.Ready,
    data: {
      externalLinkId: id,
      companyName: company.data?.name ?? "Our Company",
      companyLogo: company.data?.logoLightIcon ?? null
    }
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { id } = params;
  if (!id) return { success: false, message: "Missing id" };

  const serviceRole = getCarbonServiceRole();
  const externalLink = await getExternalLink(serviceRole, id);

  if (externalLink.error || !externalLink.data) {
    return { success: false, message: "Link not found" };
  }

  const customerId = externalLink.data.documentId;
  const companyId = externalLink.data.companyId;

  // Get customer details
  const customer = await serviceRole
    .from("customer")
    .select("name")
    .eq("id", customerId)
    .single();

  // Get customer email
  const customerContact = await serviceRole
    .from("customerContact")
    .select("contact(email)")
    .eq("customerId", customerId)
    .limit(1)
    .maybeSingle();

  const email = (customerContact.data as any)?.contact?.email;

  // Ensure Stripe customer
  const stripeCustomerId = await getOrCreateStripeCustomer(serviceRole, {
    customerId,
    companyId,
    email: email ?? `customer-${customerId}@placeholder.com`,
    name: customer.data?.name ?? "Customer",
    userId: "system"
  });

  const company = await serviceRole
    .from("company")
    .select("name")
    .eq("id", companyId)
    .single();

  const session = await createSetupCheckoutSession({
    stripeCustomerId,
    externalLinkId: id,
    companyName: company.data?.name ?? ""
  });

  if (session.url) {
    throw redirect(session.url);
  }

  return { success: false, message: "Failed to create checkout session" };
}

export default function AddCardPage() {
  const { state, data } = useLoaderData<typeof loader>();
  const mode = useMode();
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  if (state === PageState.NotFound) {
    return (
      <CenteredPage mode={mode}>
        <LuX className="mx-auto h-12 w-12 text-red-500" />
        <Heading size="h3">Link Not Found</Heading>
        <p className="text-muted-foreground">
          This link is invalid or has expired.
        </p>
      </CenteredPage>
    );
  }

  if (state === PageState.Success) {
    return (
      <CenteredPage mode={mode}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <LuCheck className="h-8 w-8 text-green-600" />
        </div>
        <Heading size="h3">Card Saved Successfully</Heading>
        <p className="text-muted-foreground">
          Your payment card has been securely saved. You can close this page.
        </p>
      </CenteredPage>
    );
  }

  if (state === PageState.Cancelled) {
    return (
      <CenteredPage mode={mode}>
        <Heading size="h3">Setup Cancelled</Heading>
        <p className="text-muted-foreground">
          Card setup was cancelled. You can try again below.
        </p>
        <fetcher.Form method="post" className="mt-4">
          <Button type="submit" size="lg" isDisabled={isSubmitting}>
            <HStack spacing={2}>
              <LuCreditCard />
              <span>{isSubmitting ? "Redirecting..." : "Try Again"}</span>
            </HStack>
          </Button>
        </fetcher.Form>
      </CenteredPage>
    );
  }

  return (
    <CenteredPage mode={mode}>
      {data?.companyLogo ? (
        <img
          src={data.companyLogo}
          alt={data?.companyName}
          className="mx-auto h-12"
        />
      ) : (
        <Heading size="h3">{data?.companyName}</Heading>
      )}
      <Heading size="h4">Add Your Card on File</Heading>
      <p className="text-muted-foreground text-center max-w-sm">
        Securely save your payment card for future invoices. Your card
        information is handled by Stripe — we never see your full card number.
      </p>
      <fetcher.Form method="post" className="mt-4">
        <Button type="submit" size="lg" isDisabled={isSubmitting}>
          <HStack spacing={2}>
            <LuCreditCard />
            <span>
              {isSubmitting ? "Redirecting to Stripe..." : "Add Card"}
            </span>
          </HStack>
        </Button>
      </fetcher.Form>
    </CenteredPage>
  );
}

function CenteredPage({
  children,
  mode
}: {
  children: React.ReactNode;
  mode: string;
}) {
  return (
    <div
      className={`flex min-h-screen items-center justify-center ${mode === "dark" ? "bg-zinc-950" : "bg-gray-50"}`}
    >
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <VStack spacing={4} className="text-center">
            {children}
          </VStack>
        </CardContent>
      </Card>
    </div>
  );
}
