import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Heading,
  HStack,
  Separator,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { formatCityStatePostalCode, formatDate } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { LuCheck, LuCreditCard } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { getPaymentTermsList } from "~/modules/accounting";
import {
  getCustomerStripeAccount,
  getSalesInvoiceByExternalId,
  getSalesInvoiceCustomerDetails,
  getSalesInvoiceLines,
  getSalesInvoiceShipment
} from "~/modules/invoicing";
import { getCompany } from "~/modules/settings";
import { getExternalLink } from "~/modules/shared";

export const meta = () => {
  return [{ title: "Digital Invoice" }];
};

enum InvoiceState {
  Valid,
  Paid,
  Expired,
  NotFound,
  Voided
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return { state: InvoiceState.NotFound, data: null };
  }

  const serviceRole = getCarbonServiceRole();

  const externalLink = await getExternalLink(serviceRole, id);
  if (externalLink.error || !externalLink.data) {
    return { state: InvoiceState.NotFound, data: null };
  }

  if (
    externalLink.data.expiresAt &&
    new Date(externalLink.data.expiresAt) < new Date()
  ) {
    return { state: InvoiceState.Expired, data: null };
  }

  const invoice = await getSalesInvoiceByExternalId(serviceRole, id);
  if (invoice.error || !invoice.data) {
    return { state: InvoiceState.NotFound, data: null };
  }

  const [company, lines, locations, shipment, paymentTerms, stripeAccount] =
    await Promise.all([
      getCompany(serviceRole, invoice.data.companyId),
      getSalesInvoiceLines(serviceRole, invoice.data.id),
      getSalesInvoiceCustomerDetails(serviceRole, invoice.data.id),
      getSalesInvoiceShipment(serviceRole, invoice.data.id),
      getPaymentTermsList(serviceRole, invoice.data.companyId),
      invoice.data.customerId
        ? getCustomerStripeAccount(
            serviceRole,
            invoice.data.customerId,
            invoice.data.companyId
          )
        : Promise.resolve({ data: null })
    ]);

  const paymentTermName =
    paymentTerms.data?.find((pt) => pt.id === invoice.data.paymentTermId)
      ?.name ?? null;

  const invoiceState =
    invoice.data.status === "Paid"
      ? InvoiceState.Paid
      : invoice.data.status === "Voided"
        ? InvoiceState.Voided
        : InvoiceState.Valid;

  return {
    state: invoiceState,
    data: {
      invoice: invoice.data,
      company: company.data,
      lines: lines.data ?? [],
      locations: locations.data,
      shipment: shipment.data,
      paymentTermName,
      externalLinkId: id,
      hasStripeCustomer: !!stripeAccount.data?.stripeCustomerId
    }
  };
}

export default function DigitalInvoicePage() {
  const { state, data } = useLoaderData<typeof loader>();
  const mode = useMode();

  if (state === InvoiceState.NotFound) {
    return (
      <CenteredMessage>
        <Heading size="h2">Invoice Not Found</Heading>
        <p className="text-muted-foreground">
          This invoice link is invalid or has been removed.
        </p>
      </CenteredMessage>
    );
  }

  if (state === InvoiceState.Expired) {
    return (
      <CenteredMessage>
        <Heading size="h2">Invoice Expired</Heading>
        <p className="text-muted-foreground">
          This invoice link has expired. Please contact the sender for a new
          link.
        </p>
      </CenteredMessage>
    );
  }

  if (!data) return null;
  const { invoice, company, lines, locations, shipment, paymentTermName } =
    data;

  const logo = mode === "dark" ? company?.logoDark : company?.logoLight;

  // Compute the real balance including shipping and tax
  const shippingCost = shipment?.shippingCost ?? 0;
  const taxAmount = invoice.totalTax ?? 0;
  // balance only tracks line item subtotal; add shipping + tax for real balance
  const balanceDue = (invoice.balance ?? 0) + shippingCost + taxAmount;

  return (
    <VStack spacing={8} className="w-full items-center p-2 md:p-8">
      {logo && (
        <img
          src={logo}
          alt={company?.name ?? ""}
          className="w-auto mx-auto max-w-5xl"
        />
      )}

      <PaymentCard
        invoice={invoice}
        state={state}
        externalLinkId={data.externalLinkId}
        company={company}
        logo={logo}
        balanceDue={balanceDue}
      />

      <Card className="w-full max-w-5xl mx-auto">
        <CardHeader>
          <div className="w-full text-center">
            <StatusBadge status={invoice.status} state={state} />
          </div>
          <InvoiceHeader
            company={company}
            invoice={invoice}
            locations={locations}
            paymentTermName={paymentTermName}
          />
        </CardHeader>
        <CardContent>
          <InvoiceLineItems
            lines={lines}
            invoice={invoice}
            shipment={shipment}
          />
        </CardContent>
      </Card>
    </VStack>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50">
      <Card className="w-full max-w-md text-center">
        <CardContent className="p-8">
          <VStack spacing={4}>{children}</VStack>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  status,
  state
}: {
  status: string;
  state: InvoiceState;
}) {
  if (state === InvoiceState.Voided || status === "Voided") {
    return <Badge variant="red">Voided</Badge>;
  }
  if (state === InvoiceState.Paid || status === "Paid") {
    return <Badge variant="green">Paid</Badge>;
  }
  if (status === "Overdue") {
    return <Badge variant="red">Overdue</Badge>;
  }
  if (status === "Partially Paid") {
    return <Badge variant="yellow">Partially Paid</Badge>;
  }
  return <Badge variant="blue">Due</Badge>;
}

function InvoiceHeader({
  company,
  invoice,
  locations,
  paymentTermName
}: {
  company: any;
  invoice: any;
  locations: any;
  paymentTermName: string | null;
}) {
  const { locale } = useLocale();

  return (
    <div className="grid gap-6 sm:grid-cols-2 w-full mt-4">
      <div>
        <div className="mb-4">
          <Heading size="h3">{company?.name}</Heading>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            Invoice {invoice.invoiceId}
          </p>
          {invoice.dateIssued && (
            <p>Issued: {formatDate(invoice.dateIssued, locale)}</p>
          )}
          {invoice.dateDue && <p>Due: {formatDate(invoice.dateDue, locale)}</p>}
          {paymentTermName && <p>Terms: {paymentTermName}</p>}
        </div>
      </div>
      <div>
        <p className="text-muted-foreground text-xs font-medium uppercase mb-2">
          Bill To
        </p>
        <p className="font-medium">
          {locations?.invoiceCustomerName ?? locations?.customerName}
        </p>
        {locations?.invoiceAddressLine1 && (
          <p className="text-muted-foreground text-sm">
            {locations.invoiceAddressLine1}
          </p>
        )}
        {locations?.invoiceAddressLine2 && (
          <p className="text-muted-foreground text-sm">
            {locations.invoiceAddressLine2}
          </p>
        )}
        {(locations?.invoiceCity ||
          locations?.invoiceStateProvince ||
          locations?.invoicePostalCode) && (
          <p className="text-muted-foreground text-sm">
            {formatCityStatePostalCode(
              locations.invoiceCity,
              locations.invoiceStateProvince,
              locations.invoicePostalCode
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function InvoiceLineItems({
  lines,
  invoice,
  shipment
}: {
  lines: any[];
  invoice: any;
  shipment: any;
}) {
  const { locale } = useLocale();
  const currencyCode = invoice.currencyCode ?? "USD";
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode
  });

  const subtotal = lines.reduce((sum, line) => {
    if (line.invoiceLineType === "Comment") return sum;
    return sum + (line.quantity ?? 0) * (line.convertedUnitPrice ?? 0);
  }, 0);

  const shippingCost = shipment?.shippingCost ?? 0;
  const taxAmount = invoice.totalTax ?? 0;
  const total = subtotal + shippingCost + taxAmount;

  return (
    <>
      <Table>
        <Thead>
          <Tr>
            <Th>Description</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">Unit Price</Th>
            <Th className="text-right">Amount</Th>
          </Tr>
        </Thead>
        <Tbody>
          {lines.map((line) => (
            <Tr key={line.id}>
              <Td>
                <p className="font-medium">
                  {line.itemName ?? line.description}
                </p>
                {line.itemDescription && (
                  <p className="text-muted-foreground text-xs">
                    {line.itemDescription}
                  </p>
                )}
              </Td>
              <Td className="text-right">
                {line.invoiceLineType === "Comment"
                  ? "-"
                  : (line.quantity ?? 0)}
              </Td>
              <Td className="text-right">
                {line.invoiceLineType === "Comment"
                  ? "-"
                  : formatter.format(line.convertedUnitPrice ?? 0)}
              </Td>
              <Td className="text-right">
                {line.invoiceLineType === "Comment"
                  ? "-"
                  : formatter.format(
                      (line.quantity ?? 0) * (line.convertedUnitPrice ?? 0)
                    )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      <Separator />
      <div className="space-y-2 p-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatter.format(subtotal)}</span>
        </div>
        {shippingCost > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Shipping</span>
            <span>{formatter.format(shippingCost)}</span>
          </div>
        )}
        {taxAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax</span>
            <span>{formatter.format(taxAmount)}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between text-lg font-semibold">
          <span>Total</span>
          <span>{formatter.format(total)}</span>
        </div>
        {invoice.balance != null &&
          (invoice.balance ?? 0) < (invoice.totalAmount ?? 0) && (
            <div className="flex justify-between text-lg font-semibold text-blue-600">
              <span>Balance Due</span>
              <span>
                {formatter.format(
                  (invoice.balance ?? 0) +
                    (shipment?.shippingCost ?? 0) +
                    (invoice.totalTax ?? 0)
                )}
              </span>
            </div>
          )}
      </div>
    </>
  );
}

function PaymentCard({
  invoice,
  state,
  externalLinkId,
  company,
  logo,
  balanceDue
}: {
  invoice: any;
  state: InvoiceState;
  externalLinkId: string;
  company: any;
  logo: string | null | undefined;
  balanceDue: number;
}) {
  const fetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const paymentResult = searchParams.get("payment");
  const { locale } = useLocale();
  const currencyCode = invoice.currencyCode ?? "USD";
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode
  });

  const isPaid = state === InvoiceState.Paid || invoice.status === "Paid";
  const isVoided = state === InvoiceState.Voided || invoice.status === "Voided";
  const isSubmitting = fetcher.state !== "idle";

  if (isVoided) {
    return (
      <Card className="w-full max-w-5xl mx-auto">
        <CardContent className="p-6 text-center">
          <Heading size="h4">Invoice Voided</Heading>
          <p className="text-muted-foreground mt-2">
            This invoice has been voided and is no longer payable.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isPaid || paymentResult === "success") {
    return (
      <Card className="w-full max-w-5xl mx-auto">
        <CardContent className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <LuCheck className="h-8 w-8 text-green-600" />
          </div>
          <Heading size="h4">Payment Complete</Heading>
          <p className="text-muted-foreground mt-2">
            Thank you for your payment.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (paymentResult === "cancelled") {
    return (
      <Card className="w-full max-w-5xl mx-auto">
        <CardContent className="p-6">
          <VStack spacing={4}>
            <div className="text-center">
              <Heading size="h4">Payment Cancelled</Heading>
              <p className="text-muted-foreground mt-2">
                Your payment was not processed. You can try again below.
              </p>
            </div>
            <Separator />
            <PayButton
              externalLinkId={externalLinkId}
              balanceDue={balanceDue}
              formatter={formatter}
              fetcher={fetcher}
              isSubmitting={isSubmitting}
            />
          </VStack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-5xl mx-auto">
      <CardContent className="p-6">
        <VStack spacing={4}>
          <div className="text-center w-full">
            <p className="text-muted-foreground text-sm">
              {company?.name} has sent you an invoice
            </p>
            <p className="text-3xl font-bold mt-1">
              {formatter.format(balanceDue)}
            </p>
            {invoice.dateDue && (
              <p className="text-muted-foreground text-sm mt-1">
                Due {formatDate(invoice.dateDue, locale)}
              </p>
            )}
          </div>
          {balanceDue > 0 && (
            <>
              <Separator />
              <PayButton
                externalLinkId={externalLinkId}
                balanceDue={balanceDue}
                formatter={formatter}
                fetcher={fetcher}
                isSubmitting={isSubmitting}
              />
            </>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}

function PayButton({
  externalLinkId,
  balanceDue,
  formatter,
  fetcher,
  isSubmitting
}: {
  externalLinkId: string;
  balanceDue: number;
  formatter: Intl.NumberFormat;
  fetcher: ReturnType<typeof useFetcher>;
  isSubmitting: boolean;
}) {
  return (
    <fetcher.Form
      method="post"
      action={`/api/invoice/payment/${externalLinkId}`}
      className="w-full"
    >
      <input type="hidden" name="type" value="checkout" />
      <Button
        type="submit"
        className="w-full"
        size="lg"
        isDisabled={isSubmitting}
      >
        <HStack spacing={2}>
          <LuCreditCard />
          <span>
            {isSubmitting
              ? "Redirecting..."
              : `Pay ${formatter.format(balanceDue)}`}
          </span>
        </HStack>
      </Button>
    </fetcher.Form>
  );
}
