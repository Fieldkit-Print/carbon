import type { Database } from "@carbon/database";
import { formatCityStatePostalCode } from "@carbon/utils";
import { Body, Hr, Html, Preview, Text } from "@react-email/components";
import type { Email } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getTotal
} from "../utils/purchase-order";
import { getCurrencyFormatter } from "../utils/shared";

interface PurchaseOrderEmailProps extends Email {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
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

const PurchaseOrderEmail = ({
  company,
  locale,
  purchaseOrder,
  purchaseOrderLines,
  purchaseOrderLocations,
  recipient,
  sender,
  paymentTerms
}: PurchaseOrderEmailProps) => {
  const {
    deliveryName,
    deliveryAddressLine1,
    deliveryAddressLine2,
    deliveryCity,
    deliveryStateProvince,
    deliveryPostalCode,
    deliveryCountryName,
    dropShipment,
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName
  } = purchaseOrderLocations;

  const formatter = getCurrencyFormatter(company.baseCurrencyCode, locale);
  const paymentTerm = paymentTerms?.find(
    (term) => term.id === purchaseOrder.paymentTermId
  );

  const addressParts = dropShipment
    ? [
        customerName,
        customerAddressLine1,
        customerAddressLine2,
        formatCityStatePostalCode(
          customerCity,
          customerStateProvince,
          customerPostalCode
        ),
        customerCountryName
      ].filter(Boolean)
    : [
        company.name,
        deliveryName,
        deliveryAddressLine1,
        deliveryAddressLine2,
        formatCityStatePostalCode(
          deliveryCity,
          deliveryStateProvince,
          deliveryPostalCode
        ),
        deliveryCountryName
      ].filter(Boolean);

  return (
    <Html>
      <Preview>
        {`${purchaseOrder.purchaseOrderId} from ${company.name}`}
      </Preview>
      <Body style={bodyStyle}>
        <Text>
          {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
        </Text>
        <Text>
          Please see the attached purchase order and let me know if you have any
          questions.
        </Text>
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={{ margin: "4px 0" }}>
          <strong>PO:</strong> {purchaseOrder.purchaseOrderId}
        </Text>
        {purchaseOrder.receiptRequestedDate && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Requested Date:</strong>{" "}
            {purchaseOrder.receiptRequestedDate}
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
        {purchaseOrderLines.map((line) => {
          if (line.purchaseOrderLineType === "Comment") {
            return (
              <Text key={line.id} style={{ ...mutedStyle, margin: "4px 0" }}>
                {getLineDescription(line)}
              </Text>
            );
          }
          const details = getLineDescriptionDetails(line);
          return (
            <Text key={line.id} style={{ margin: "4px 0" }}>
              {getLineDescription(line)} — {line.purchaseQuantity}{" "}
              {line.purchaseUnitOfMeasureCode}
              {line.unitPrice ? ` x ${formatter.format(line.unitPrice)}` : ""}
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
          Total: {formatter.format(getTotal(purchaseOrderLines))}
        </Text>
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={mutedStyle}>{company.name}</Text>
      </Body>
    </Html>
  );
};

export default PurchaseOrderEmail;
