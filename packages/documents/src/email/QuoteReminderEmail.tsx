import { Body, Hr, Html, Link, Preview, Text } from "@react-email/components";
import type { Email } from "../types";

interface QuoteReminderEmailProps extends Email {
  quoteId: string;
  digitalQuoteUrl?: string;
  expirationDate?: string | null;
  daysSinceSent: number;
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

function getReminderCopy(
  daysSinceSent: number,
  expirationDate?: string | null
) {
  if (daysSinceSent >= 5) {
    const expiresNote = expirationDate
      ? ` It is set to expire on ${expirationDate}.`
      : "";
    return `We haven't heard back on this quote yet.${expiresNote} Please take a moment to review it at your earliest convenience.`;
  }
  if (daysSinceSent >= 2) {
    return "Just checking in on the quote we sent over. Please let us know if you have any questions or need any changes.";
  }
  return "Following up on the quote we sent yesterday. We'd love to hear your thoughts when you have a chance.";
}

const QuoteReminderEmail = ({
  company,
  quoteId,
  digitalQuoteUrl,
  expirationDate,
  daysSinceSent,
  recipient
}: QuoteReminderEmailProps) => {
  return (
    <Html>
      <Preview>{`Reminder: Quote ${quoteId} from ${company.name}`}</Preview>
      <Body style={bodyStyle}>
        <Text>
          {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
        </Text>
        <Text>{getReminderCopy(daysSinceSent, expirationDate)}</Text>
        {digitalQuoteUrl && (
          <Text>
            <Link href={digitalQuoteUrl}>View Quote</Link>
          </Text>
        )}
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={{ margin: "4px 0" }}>
          <strong>Quote:</strong> {quoteId}
        </Text>
        {expirationDate && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Expires:</strong> {expirationDate}
          </Text>
        )}
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={mutedStyle}>{company.name}</Text>
      </Body>
    </Html>
  );
};

export default QuoteReminderEmail;
