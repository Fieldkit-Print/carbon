import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

/**
 * Shipstation integration — replaces the prior Easypost flow.
 *
 * Shipstation talks to Carbon via Custom Store polling: it pulls
 * `awaiting_shipment` orders from the URL shown in setup, operators
 * buy labels in Shipstation, and Shipstation pushes shipnotify back
 * to the same URL with tracking. The handler then calls Shipstation's
 * REST API (apiKey + apiSecret) to fetch the shipment cost the
 * shipnotify payload doesn't carry.
 *
 *   - apiKey / apiSecret           — outbound, Carbon → Shipstation
 *   - basicAuthUsername / Password — inbound, Shipstation → Carbon
 *
 * @see {@link file://./../../../apps/erp/app/routes/api+/shipstation.orders.$companyId.ts}
 */
export const Shipstation = defineIntegration({
  name: "Shipstation",
  id: "shipstation",
  active: true,
  category: "Shipping",
  logo: Logo,
  description:
    "Shipstation centralizes shipping across 100+ carriers — operators pick rates and print labels inside Shipstation, while Carbon stays the source of truth for what is being shipped to whom. Tracking + carrier cost flow back automatically once a label is bought, ready to be billed in Carbon.",
  shortDescription: "Push shipments to Shipstation; pull tracking + cost back.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [
    {
      name: "apiKey",
      label: "API Key",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "apiSecret",
      label: "API Secret",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "basicAuthUsername",
      label: "Custom Store username",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "basicAuthPassword",
      label: "Custom Store password",
      type: "text",
      required: true,
      value: ""
    }
  ],
  schema: z.object({
    apiKey: z.string().min(1, { message: "API Key is required" }),
    apiSecret: z.string().min(1, { message: "API Secret is required" }),
    basicAuthUsername: z
      .string()
      .min(1, { message: "Custom Store username is required" }),
    basicAuthPassword: z
      .string()
      .min(8, {
        message: "Custom Store password must be at least 8 characters"
      })
  })
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const customStoreUrl = isBrowser
    ? `${window.location.origin}/api/shipstation/orders/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To integrate Shipstation with Carbon you'll set up an API key on
        Shipstation's side and connect a Custom Store pointed at the URL below.
        Two channels of credentials are needed:
      </p>
      <ol className="ml-4 list-decimal text-sm text-muted-foreground [&_li]:mt-2">
        <li>
          <strong>API Key + API Secret</strong> — Shipstation → Settings →
          Account → API Settings → Generate New API Keys. Paste both values into
          the fields below. Carbon uses these to fetch the shipment cost after
          each label is bought.
        </li>
        <li>
          <strong>Custom Store credentials</strong> — pick any username/password
          pair. Enter them below, then in Shipstation go to Settings → Selling
          Channels → Store Setup → Connect a Store → choose{" "}
          <em>Custom Store</em> at the bottom and paste the URL below into{" "}
          <em>URL to Custom XML Page</em>, response format set to XML, then
          enter the same username + password.
        </li>
      </ol>
      <InputGroup className="mb-8">
        <Input value={customStoreUrl} />
        <InputRightElement>
          <Copy text={customStoreUrl} />
        </InputRightElement>
      </InputGroup>
    </>
  );
}

function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1" />
      <polyline points="16 8 22 12 16 16" />
      <line x1="11" y1="12" x2="22" y2="12" />
    </svg>
  );
}
