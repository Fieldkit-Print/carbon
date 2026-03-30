import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  generateHTML,
  Heading,
  HStack,
  Separator,
  VStack
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import {
  createSetupCheckoutSession,
  getOrCreateStripeCustomer
} from "@carbon/stripe/invoice-payments.server";
import { useState } from "react";
import { LuCheck, LuCreditCard, LuX } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { getCompany, getTerms } from "~/modules/settings";
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

  const [company, terms] = await Promise.all([
    getCompany(serviceRole, externalLink.data.companyId),
    getTerms(serviceRole, externalLink.data.companyId)
  ]);

  return {
    state: PageState.Ready,
    data: {
      externalLinkId: id,
      company: company.data,
      cardOnFileTerms: terms.data?.cardOnFileTerms ?? null
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

  const logo =
    mode === "dark" ? data?.company?.logoDark : data?.company?.logoLight;

  if (state === PageState.NotFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/50">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8">
            <VStack spacing={4} className="items-center">
              <LuX className="h-12 w-12 text-red-500" />
              <Heading size="h3">Link Not Found</Heading>
              <p className="text-muted-foreground">
                This link is invalid or has expired.
              </p>
            </VStack>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === PageState.Success) {
    return (
      <div className="min-h-screen bg-muted/50">
        <VStack spacing={8} className="w-full items-center p-2 md:p-8">
          {logo && (
            <img
              src={logo}
              alt={data?.company?.name ?? ""}
              className="w-auto mx-auto max-w-5xl"
            />
          )}
          <Card className="w-full max-w-xl mx-auto">
            <CardContent className="p-8">
              <VStack spacing={4} className="items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <LuCheck className="h-8 w-8 text-green-600" />
                </div>
                <Heading size="h3">Card Saved Successfully</Heading>
                <p className="text-muted-foreground">
                  Your payment card has been securely saved. You can close this
                  page.
                </p>
              </VStack>
            </CardContent>
          </Card>
        </VStack>
      </div>
    );
  }

  if (state === PageState.Cancelled) {
    return (
      <div className="min-h-screen bg-muted/50">
        <VStack spacing={8} className="w-full items-center p-2 md:p-8">
          {logo && (
            <img
              src={logo}
              alt={data?.company?.name ?? ""}
              className="w-auto mx-auto max-w-5xl"
            />
          )}
          <Card className="w-full max-w-xl mx-auto">
            <CardContent className="p-8">
              <VStack spacing={4} className="items-center text-center">
                <Heading size="h3">Setup Cancelled</Heading>
                <p className="text-muted-foreground">
                  Card setup was cancelled. You can try again below.
                </p>
                <fetcher.Form method="post" className="w-full">
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    isDisabled={isSubmitting}
                  >
                    <HStack spacing={2}>
                      <LuCreditCard />
                      <span>
                        {isSubmitting ? "Redirecting..." : "Try Again"}
                      </span>
                    </HStack>
                  </Button>
                </fetcher.Form>
              </VStack>
            </CardContent>
          </Card>
        </VStack>
      </div>
    );
  }

  return (
    <ReadyState
      data={data}
      logo={logo}
      fetcher={fetcher}
      isSubmitting={isSubmitting}
    />
  );
}

function ReadyState({
  data,
  logo,
  fetcher,
  isSubmitting
}: {
  data: any;
  logo: string | null | undefined;
  fetcher: ReturnType<typeof useFetcher>;
  isSubmitting: boolean;
}) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const hasTerms =
    data?.cardOnFileTerms &&
    typeof data.cardOnFileTerms === "object" &&
    Object.keys(data.cardOnFileTerms).length > 0;

  let termsHTML = "";
  if (hasTerms) {
    try {
      termsHTML = generateHTML(data.cardOnFileTerms as JSONContent);
    } catch {
      // If terms can't be rendered, skip them
    }
  }

  return (
    <div className="min-h-screen bg-muted/50">
      <VStack spacing={8} className="w-full items-center p-2 md:p-8">
        {logo && (
          <img
            src={logo}
            alt={data?.company?.name ?? ""}
            className="w-auto mx-auto max-w-5xl"
          />
        )}

        <Card className="w-full max-w-xl mx-auto">
          <CardContent className="p-8">
            <VStack spacing={6} className="items-center text-center">
              <div>
                <Heading size="h4">Add Your Card on File</Heading>
                <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                  Securely save your payment card for future invoices. Your card
                  information is handled by Stripe — we never see your full card
                  number.
                </p>
              </div>

              {hasTerms && termsHTML && (
                <>
                  <Separator />
                  <div className="w-full text-left">
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: termsHTML }}
                    />
                    <label className="flex items-start gap-3 mt-4 cursor-pointer">
                      <Checkbox
                        checked={termsAccepted}
                        onCheckedChange={(checked) =>
                          setTermsAccepted(checked === true)
                        }
                      />
                      <span className="text-sm text-foreground">
                        I understand and agree to the terms of having a card on
                        file
                      </span>
                    </label>
                  </div>
                </>
              )}

              <fetcher.Form method="post" className="w-full">
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  isDisabled={isSubmitting || (hasTerms && !termsAccepted)}
                >
                  <HStack spacing={2}>
                    <LuCreditCard />
                    <span>
                      {isSubmitting ? "Redirecting to Stripe..." : "Add Card"}
                    </span>
                  </HStack>
                </Button>
              </fetcher.Form>
            </VStack>
          </CardContent>
        </Card>
      </VStack>
    </div>
  );
}
