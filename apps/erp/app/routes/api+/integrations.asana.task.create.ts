import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getAsanaClient,
  getAsanaIntegration,
  linkActionToAsanaTask
} from "@carbon/ee/asana.server";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";

const asana = getAsanaClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const form = await request.formData();
    const { companyId, client } = await requirePermissions(request, {});

    const actionId = form.get("actionId") as string;
    const name = form.get("name") as string;
    const description = form.get("description") as string;
    const assigneeGid = form.get("assignee") as string;

    // Get the issues project from integration settings
    const { data: integrations } = await getAsanaIntegration(client, companyId);
    const integration = integrations?.[0];
    const metadata = integration?.metadata as {
      workspaceGid?: string;
      issuesProjectGid?: string;
    };

    if (!metadata?.workspaceGid || !metadata?.issuesProjectGid) {
      return data(
        {
          success: false,
          message: "Asana workspace or issues project not configured"
        },
        { status: 400 }
      );
    }

    const task = await asana.createTask(companyId, {
      name,
      html_notes: description ? `<body>${description}</body>` : undefined,
      projects: [metadata.issuesProjectGid],
      assignee: assigneeGid || null,
      workspace: metadata.workspaceGid
    });

    if (!task) {
      return data(
        { success: false, message: "Failed to create Asana task" },
        { status: 400 }
      );
    }

    await linkActionToAsanaTask(client, companyId, {
      actionId,
      task
    });

    return { success: true, message: "Asana task created" };
  } catch (error) {
    console.error("Asana task create error:", error);
    return data(
      { success: false, message: "Failed to create task" },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const { companyId, client } = await requirePermissions(request, {});

  // Get workspace from integration settings
  const { data: integrations } = await getAsanaIntegration(client, companyId);
  const integration = integrations?.[0];
  const metadata = integration?.metadata as { workspaceGid?: string };

  if (!metadata?.workspaceGid) {
    return { members: [] };
  }

  const workspaceGid = metadata.workspaceGid;

  // Return workspace members for assignee selection
  const members = await asana.getWorkspaceUsers(companyId, workspaceGid);

  // Filter to company employees
  const { getCompanyEmployees } = await import("@carbon/ee/asana.server");
  const employees = await getCompanyEmployees(
    client,
    companyId,
    members.map((m) => m.email)
  );

  return {
    members: members.filter((m) =>
      employees.some(
        (v) =>
          v.user?.email &&
          m.email &&
          v.user.email.toLowerCase() === m.email.toLowerCase()
      )
    )
  };
};
