import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getAsanaClient,
  getAsanaIntegration,
  linkActionToAsanaTask,
  unlinkActionFromAsanaTask
} from "@carbon/ee/asana.server";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";

const asana = getAsanaClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const { companyId, client } = await requirePermissions(request, {});
    const form = await request.formData();

    const actionId = form.get("actionId") as string;

    if (!actionId) {
      return { success: false, message: "Missing required fields: actionId" };
    }

    switch (request.method) {
      case "POST": {
        const taskGid = form.get("taskGid") as string;

        if (!taskGid) {
          return {
            success: false,
            message: "Missing required fields: taskGid"
          };
        }

        const task = await asana.getTaskById(companyId, taskGid);

        if (!task) {
          return { success: false, message: "Task not found" };
        }

        const email = task.assignee?.email ?? "";
        let assignee: string | null = null;

        if (email) {
          const { data: user } = await client
            .from("user")
            .select("id")
            .eq("email", email)
            .single();
          assignee = user?.id ?? null;
        }

        const linked = await linkActionToAsanaTask(client, companyId, {
          actionId,
          task,
          assignee
        });

        if (!linked || linked.data?.length === 0) {
          return { success: false, message: "Failed to link task" };
        }

        return { success: true, message: "Linked successfully" };
      }

      case "DELETE": {
        const unlinked = await unlinkActionFromAsanaTask(client, companyId, {
          actionId
        });

        if (unlinked.error) {
          return { success: false, message: "Failed to unlink task" };
        }

        return { success: true, message: "Unlinked successfully" };
      }
    }
  } catch (error) {
    console.error("Asana task link action error:", error);
    return data(
      { success: false, message: "Failed to process request" },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const { companyId, client } = await requirePermissions(request, {});
  const url = new URL(request.url);

  const query = url.searchParams.get("search") as string;

  if (!query || query.length < 3) {
    return { tasks: [] };
  }

  // Get workspace from integration settings
  const { data: integrations } = await getAsanaIntegration(client, companyId);
  const integration = integrations?.[0];
  const metadata = integration?.metadata as { workspaceGid?: string };

  if (!metadata?.workspaceGid) {
    return { tasks: [] };
  }

  const tasks = await asana.searchTasks(
    companyId,
    metadata.workspaceGid,
    query
  );

  return { tasks };
};
