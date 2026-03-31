import { Body, Hr, Html, Link, Preview, Text } from "@react-email/components";
import type { Email } from "../types";

interface ProofApprovalEmailProps extends Email {
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

const ProofApprovalEmail = ({
  company,
  jobName,
  proofUrl,
  version,
  recipient
}: ProofApprovalEmailProps) => {
  return (
    <Html>
      <Preview>{`Proof approval requested — ${jobName}`}</Preview>
      <Body style={bodyStyle}>
        <Text>
          {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
        </Text>
        <Text>
          {company.name} has sent you a proof for review. Please review and
          approve or reject the proof for <strong>{jobName}</strong> (Version{" "}
          {version}).
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

export default ProofApprovalEmail;
