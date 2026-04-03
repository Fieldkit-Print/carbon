import { Body, Hr, Html, Link, Preview, Text } from "@react-email/components";
import type { Email } from "../types";

interface ProofReminderEmailProps extends Email {
  jobName: string;
  proofUrl: string;
  version: number;
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

const ProofReminderEmail = ({
  company,
  jobName,
  proofUrl,
  version,
  recipient
}: ProofReminderEmailProps) => {
  return (
    <Html>
      <Preview>{`Reminder: Proof awaiting approval — ${jobName}`}</Preview>
      <Body style={bodyStyle}>
        <Text>
          {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
        </Text>
        <Text>
          A proof for <strong>{jobName}</strong> (Version {version}) is still
          awaiting your review. Please take a moment to approve or reject it at
          your earliest convenience.
        </Text>
        <Text>
          <Link href={proofUrl}>Review Proof</Link>
        </Text>
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={mutedStyle}>{company.name}</Text>
      </Body>
    </Html>
  );
};

export default ProofReminderEmail;
