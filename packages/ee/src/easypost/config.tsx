import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

export const EasyPost = defineIntegration({
  name: "EasyPost",
  id: "easypost",
  active: true,
  category: "Shipping",
  logo: Logo,
  description:
    "EasyPost is a shipping API that provides rate shopping across 100+ carriers, label generation, and real-time package tracking. This integration enables carrier rate comparison, label purchase, and automatic tracking updates for shipments in Carbon.",
  shortDescription: "Rate shopping, label generation, and package tracking.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [
    {
      name: "apiKey",
      label: "Production API Key",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "testApiKey",
      label: "Test API Key",
      type: "text",
      required: false,
      value: ""
    },
    {
      name: "webhookSecret",
      label: "Webhook Secret",
      type: "text",
      required: false,
      value: ""
    }
  ],
  schema: z.object({
    apiKey: z.string().min(1, { message: "Production API Key is required" }),
    testApiKey: z.string().optional(),
    webhookSecret: z.string().optional()
  })
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/easypost/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To integrate EasyPost with Carbon, log into your EasyPost dashboard and
        navigate to the API Keys section.
      </p>
      <p className="text-sm text-muted-foreground">
        Copy your Production API Key (and optionally your Test API Key) and
        paste them into the fields below.
      </p>
      <p className="text-sm text-muted-foreground">
        To enable real-time tracking updates, add the following webhook URL in
        your EasyPost dashboard under Webhooks:
      </p>
      <InputGroup className="mb-8">
        <Input value={webhookUrl} />
        <InputRightElement>
          <Copy text={webhookUrl} />
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
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
