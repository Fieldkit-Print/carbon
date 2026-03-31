import type { Database } from "@carbon/database";
import { formatCityStatePostalCode } from "@carbon/utils";
import { Body, Hr, Html, Preview, Text } from "@react-email/components";
import type { Email } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal,
  getTotal
} from "../utils/sales-order";
import { getCurrencyFormatter } from "../utils/shared";

interface SalesOrderEmailProps extends Email {
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"];
  salesOrderLines: Database["public"]["Views"]["salesOrderLines"]["Row"][];
  salesOrderLocations: Database["public"]["Views"]["salesOrderLocations"]["Row"];
  paymentTerms: { id: string; name: string }[];
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

const SalesOrderEmail = ({
  company,
  locale,
  salesOrder,
  salesOrderLines,
  salesOrderLocations,
  recipient,
  sender,
  paymentTerms
}: SalesOrderEmailProps) => {
  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName
  } = salesOrderLocations;

  const formatter = getCurrencyFormatter(company.baseCurrencyCode, locale);
  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesOrder.paymentTermId
  );

  const addressParts = [
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    formatCityStatePostalCode(
      customerCity,
      customerStateProvince,
      customerPostalCode
    ),
    customerCountryName
  ].filter(Boolean);

  return (
    <Html>
      <Preview>{`${salesOrder.salesOrderId} from ${company.name}`}</Preview>
      <Body style={bodyStyle}>
        <Text>
          {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
        </Text>
        <Text>
          Please see the attached sales order and let me know if you have any
          questions.
        </Text>
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={{ margin: "4px 0" }}>
          <strong>Order:</strong> {salesOrder.salesOrderId}
        </Text>
        {salesOrder.receiptRequestedDate && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Requested Date:</strong> {salesOrder.receiptRequestedDate}
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
        {salesOrderLines.map((line) => {
          if (line.salesOrderLineType === "Comment") {
            return (
              <Text key={line.id} style={{ ...mutedStyle, margin: "4px 0" }}>
                {getLineDescription(line)}
              </Text>
            );
          }
          const details = getLineDescriptionDetails(line);
          return (
            <Text key={line.id} style={{ margin: "4px 0" }}>
              {getLineDescription(line)} — Qty: {line.saleQuantity} x{" "}
              {formatter.format(line.unitPrice ?? 0)} ={" "}
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
          Total: {formatter.format(getTotal(salesOrderLines, salesOrder))}
        </Text>
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={mutedStyle}>{company.name}</Text>
      </Body>
    </Html>
  );
};

export default SalesOrderEmail;
