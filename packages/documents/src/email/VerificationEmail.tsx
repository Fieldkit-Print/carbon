import { Body, Html, Preview, Text } from "@react-email/components";

interface Props {
  email?: string;
  verificationCode?: string;
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

export const VerificationEmail = ({
  email = "user@example.com",
  verificationCode = "123456"
}: Props) => {
  return (
    <Html>
      <Preview>{`Your verification code is ${verificationCode}`}</Preview>
      <Body style={bodyStyle}>
        <Text>Your verification code is:</Text>
        <Text
          style={{
            fontSize: "28px",
            fontWeight: "bold",
            letterSpacing: "6px",
            fontFamily: "monospace"
          }}
        >
          {verificationCode}
        </Text>
        <Text>This code expires in 10 minutes.</Text>
        <Text style={mutedStyle}>
          If you didn't request this code, you can ignore this email.
        </Text>
      </Body>
    </Html>
  );
};

export default VerificationEmail;
