import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

export const Asana = defineIntegration({
  name: "Asana",
  id: "asana",
  active: true,
  category: "Project Management",
  logo: Logo,
  description:
    "Asana is a project management tool that helps teams organize, track, and manage work. With this integration, you can link quality issues and sales orders from Carbon to Asana tasks.",
  shortDescription: "Sync issues and sales orders to Asana.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [
    {
      name: "accessToken",
      label: "Personal Access Token",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "workspaceGid",
      label: "Workspace",
      type: "options" as const,
      listOptions: [],
      required: false,
      value: ""
    },
    {
      name: "issuesProjectGid",
      label: "Issues Project",
      type: "options" as const,
      listOptions: [],
      required: false,
      value: ""
    }
  ],
  schema: z.object({
    accessToken: z
      .string()
      .min(1, { message: "Personal Access Token is required" }),
    workspaceGid: z.string().optional(),
    issuesProjectGid: z.string().optional()
  })
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/${Asana.id}/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To integrate Asana with Carbon, start by logging into your Asana account
        and navigating to the Developer Console at{" "}
        <a
          href="https://app.asana.com/0/developer-console"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          app.asana.com/0/developer-console
        </a>
        .
      </p>
      <p className="text-sm text-muted-foreground">
        Click on "Personal access tokens" and create a new token. Copy the
        generated token and paste it into the "Personal Access Token" field
        below.
      </p>
      <p className="text-sm text-muted-foreground">
        After saving the token, select your workspace and issues project from
        the dropdowns below. The issues project is where all quality
        non-conformance tasks will be synced, and a webhook subscription on that
        project is created automatically when you save.
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

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={200}
      height={200}
      {...props}
    >
      <circle cx="256" cy="130" r="114" fill="currentColor" />
      <circle cx="114" cy="382" r="114" fill="currentColor" />
      <circle cx="398" cy="382" r="114" fill="currentColor" />
    </svg>
  );
}
