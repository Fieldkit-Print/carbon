import { Body, Hr, Html, Link, Preview, Text } from "@react-email/components";

interface Props {
  email?: string;
  name?: string;
  invitedByEmail?: string;
  invitedByName?: string;
  companyName?: string;
  inviteLink?: string;
  ip?: string;
  location?: string;
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

export const InviteEmail = ({
  invitedByEmail = "tom@sawyer.com",
  invitedByName = "Tom Sawyer",
  email = "huck@sawyer.com",
  name,
  companyName = "Tombstone",
  inviteLink = "https://carbon.ms/invite/1234567890",
  ip = "38.38.38.38",
  location = "Tombstone, AZ"
}: Props) => {
  return (
    <Html>
      <Preview>{`You're invited to join ${companyName}`}</Preview>
      <Body style={bodyStyle}>
        <Text>Hi{name ? ` ${name}` : ""},</Text>
        <Text>
          {invitedByName} ({invitedByEmail}) has invited you to join{" "}
          <strong>{companyName}</strong>.
        </Text>
        <Text>
          Accept the invitation here:{" "}
          <Link href={inviteLink}>{inviteLink}</Link>
        </Text>
        <Hr style={{ borderColor: "#eee" }} />
        <Text style={mutedStyle}>
          This invitation was intended for {email}. It was sent from {ip}{" "}
          located in {location}. If you were not expecting this invitation, you
          can ignore this email.
        </Text>
      </Body>
    </Html>
  );
};

export default InviteEmail;
