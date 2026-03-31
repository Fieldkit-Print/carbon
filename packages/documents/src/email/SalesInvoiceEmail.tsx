import type { Database } from "@carbon/database";
import { formatCityStatePostalCode } from "@carbon/utils";
import { Body, Hr, Html, Link, Preview, Text } from "@react-email/components";
import type { Email } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal,
  getTotal
} from "../utils/sales-invoice";
import { getCurrencyFormatter } from "../utils/shared";

interface SalesInvoiceEmailProps extends Email {
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"];
  salesInvoiceLines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][];
  salesInvoiceLocations: Database["public"]["Views"]["salesInvoiceLocations"]["Row"];
  salesInvoiceShipment: Database["public"]["Tables"]["salesInvoiceShipment"]["Row"];
  paymentTerms: { id: string; name: string }[];
  digitalInvoiceUrl?: string;
}

const bodyStyle = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  color: "#333",
  fontSize: "14px",
  lineHeight: "1.6",
  maxWidth: "600px"
};

const mutedStyle = { color: "#666", fontSize: "13px" };

const SalesInvoiceEmail = ({
  company,
  locale,
  salesInvoice,
  salesInvoiceLines,
  salesInvoiceLocations,
  salesInvoiceShipment,
  recipient,
  sender,
  paymentTerms,
  digitalInvoiceUrl
}: SalesInvoiceEmailProps) => {
  const {
    invoiceCustomerName,
    invoiceAddressLine1,
    invoiceAddressLine2,
    invoiceCity,
    invoiceStateProvince,
    invoicePostalCode,
    invoiceCountryName
  } = salesInvoiceLocations;

  const currencyCode = salesInvoice.currencyCode ?? company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode, locale);
  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesInvoice.paymentTermId
  );

  const addressParts = [
    invoiceCustomerName,
    invoiceAddressLine1,
    invoiceAddressLine2,
    formatCityStatePostalCode(
      invoiceCity,
      invoiceStateProvince,
      invoicePostalCode
    ),
    invoiceCountryName
  ].filter(Boolean);

  return (
    <Html>
      <Preview>{`${salesInvoice.invoiceId} from ${company.name}`}</Preview>
      <Body style={bodyStyle}>
        <Text>
          {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
        </Text>
        <Text>
          Please see the attached invoice and let me know if you have any
          questions.
        </Text>
        {digitalInvoiceUrl && (
          <Text>
            You can view and pay this invoice here:{" "}
            <Link href={digitalInvoiceUrl}>{digitalInvoiceUrl}</Link>
          </Text>
        )}
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={{ margin: "4px 0" }}>
          <strong>Invoice:</strong> {salesInvoice.invoiceId}
        </Text>
        {salesInvoice.dateDue && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Due Date:</strong> {salesInvoice.dateDue}
          </Text>
        )}
        {paymentTerm && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Payment Terms:</strong> {paymentTerm.name}
          </Text>
        )}
        {addressParts.length > 0 && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Ship To:</strong> {addressParts.join(", ")}
          </Text>
        )}
        <Hr style={{ borderColor: "#eee" }} />
        {salesInvoiceLines.map((line) => {
          if (line.invoiceLineType === "Comment") {
            return (
              <Text key={line.id} style={{ ...mutedStyle, margin: "4px 0" }}>
                {getLineDescription(line)}
              </Text>
            );
          }
          const details = getLineDescriptionDetails(line);
          return (
            <Text key={line.id} style={{ margin: "4px 0" }}>
              {getLineDescription(line)} — Qty: {line.quantity} x{" "}
              {formatter.format(line.convertedUnitPrice ?? 0)} ={" "}
              {formatter.format(getLineTotal(line))}
              {details && (
                <>
                  <br />
                  <span style={mutedStyle}>{details}</span>
                </>
              )}
            </Text>
          );
        })}
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={{ fontWeight: "bold" }}>
          Total:{" "}
          {formatter.format(
            getTotal(salesInvoiceLines, salesInvoice, salesInvoiceShipment)
          )}
        </Text>
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={mutedStyle}>{company.name}</Text>
      </Body>
    </Html>
  );
};

export default SalesInvoiceEmail;
