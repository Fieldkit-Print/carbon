import { getAppUrl } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { Body, Hr, Html, Link, Preview, Text } from "@react-email/components";
import type { CompanySettings, Email } from "../types";

interface QuoteEmailProps extends Email {
  quote: Database["public"]["Tables"]["quote"]["Row"];
  companySettings: CompanySettings;
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

const QuoteEmail = ({
  company,
  companySettings,
  quote,
  recipient,
  sender
}: QuoteEmailProps) => {
  const digitalQuoteUrl =
    companySettings.digitalQuoteEnabled && !!quote.externalLinkId
      ? `${getAppUrl()}/share/quote/${quote.externalLinkId}`
      : undefined;

  return (
    <Html>
      <Preview>{`${quote.quoteId} from ${company.name}`}</Preview>
      <Body style={bodyStyle}>
        <Text>
          {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
        </Text>
        {digitalQuoteUrl ? (
          <Text>
            Please find your quote below. You can also view the digital quote
            here: <Link href={digitalQuoteUrl}>{digitalQuoteUrl}</Link>
          </Text>
        ) : (
          <Text>
            Please see the attached quote and let me know if you have any
            questions.
          </Text>
        )}
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={{ margin: "4px 0" }}>
          <strong>Quote:</strong> {quote.quoteId}
        </Text>
        {quote.customerReference && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Reference:</strong> {quote.customerReference}
          </Text>
        )}
        {quote.expirationDate && (
          <Text style={{ margin: "4px 0" }}>
            <strong>Expires:</strong> {quote.expirationDate}
          </Text>
        )}
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={mutedStyle}>{company.name}</Text>
      </Body>
    </Html>
  );
};

export default QuoteEmail;
