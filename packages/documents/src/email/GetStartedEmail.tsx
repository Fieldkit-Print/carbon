import { Body, Html, Link, Preview, Text } from "@react-email/components";

interface Props {
  firstName?: string;
  academyUrl?: string;
}

const bodyStyle = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  color: "#333",
  fontSize: "14px",
  lineHeight: "1.6",
  maxWidth: "600px"
};

export const GetStartedEmail = ({
  firstName = "Huckleberry",
  academyUrl = "https://learn.carbon.ms"
}: Props) => {
  return (
    <Html>
      <Preview>
        {`Hi ${firstName}, just checking in to help you get started.`}
      </Preview>
      <Body style={bodyStyle}>
        <Text>Hi {firstName},</Text>
        <Text>
          Just checking in to help you get started. Here are a few things you
          can learn more about:
        </Text>
        <Text style={{ margin: "4px 0" }}>
          -{" "}
          <Link href={`${academyUrl}/course/carbon-overview/the-basics`}>
            The Basics
          </Link>{" "}
          - Essential building blocks: tables, forms, documents, and custom
          fields
        </Text>
        <Text style={{ margin: "4px 0" }}>
          -{" "}
          <Link
            href={`${academyUrl}/course/getting-started/setting-up-company`}
          >
            Setting up Your Company
          </Link>
        </Text>
        <Text style={{ margin: "4px 0" }}>
          -{" "}
          <Link href={`${academyUrl}/course/parts-materials/defining-item`}>
            Defining Items
          </Link>
        </Text>
        <Text style={{ margin: "4px 0" }}>
          -{" "}
          <Link href={`${academyUrl}/course/selling/quoting-estimating`}>
            Quoting and Estimating
          </Link>
        </Text>
        <Text style={{ margin: "4px 0" }}>
          -{" "}
          <Link href={`${academyUrl}/course/manufacturing/managing-production`}>
            Managing Production
          </Link>
        </Text>
        <Text style={{ margin: "4px 0" }}>
          -{" "}
          <Link href={`${academyUrl}/course/buying/purchasing-basics`}>
            Purchasing Basics
          </Link>
        </Text>
        <Text style={{ margin: "4px 0" }}>
          -{" "}
          <Link href={`${academyUrl}/course/developing/using-api`}>
            Using the API
          </Link>
        </Text>
        <Text>
          Let us know if you have any thoughts or feedback — we'd love to hear
          from you.
        </Text>
        <Text>
          Best,
          <br />
          The Fieldkit Team
        </Text>
      </Body>
    </Html>
  );
};

export default GetStartedEmail;
