import { Body, Hr, Html, Link, Preview, Text } from "@react-email/components";
import type { Email } from "../types";

interface InvoiceReminderEmailProps extends Email {
  invoiceId: string;
  digitalInvoiceUrl: string;
  dateDue?: string | null;
  totalAmount?: number;
  balance?: number;
  isOverdue: boolean;
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

function getReminderCopy(isOverdue: boolean, dateDue?: string | null) {
  if (isOverdue) {
    return `This invoice is now past due${dateDue ? ` (due ${dateDue})` : ""}. Please arrange payment at your earliest convenience to avoid any disruption.`;
  }
  return `Friendly reminder that this invoice is due${dateDue ? ` on ${dateDue}` : " soon"}. Please review and arrange payment when you have a chance.`;
}

const InvoiceReminderEmail = ({
  company,
  invoiceId,
  digitalInvoiceUrl,
  dateDue,
  totalAmount,
  balance,
  isOverdue,
  recipient
}: InvoiceReminderEmailProps) => {
  return (
    <Html>
      <Preview>
        {isOverdue
          ? `Overdue: Invoice ${invoiceId} from ${company.name}`
          : `Reminder: Invoice ${invoiceId} from ${company.name}`}
      </Preview>
      <Body style={bodyStyle}>
        <Text>
          {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
        </Text>
        <Text>{getReminderCopy(isOverdue, dateDue)}</Text>
        <Text>
          <Link href={digitalInvoiceUrl}>View Invoice</Link>
        </Text>
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={{ margin: "4px 0" }}>
          <strong>Invoice:</strong> {invoiceId}
        </Text>
        {dateDue && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Due:</strong> {dateDue}
          </Text>
        )}
        {typeof balance === "number" && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Balance Due:</strong> ${balance.toFixed(2)}
          </Text>
        )}
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={mutedStyle}>{company.name}</Text>
      </Body>
    </Html>
  );
};

export default InvoiceReminderEmail;
