import { requirePermissions } from "@carbon/auth/auth.server";
import {
  formatEntityTaskName,
  getAsanaClient,
  getAsanaIntegration,
  getAsanaTaskFromExternalId,
  linkEntityToAsanaTask,
  mapEntityStatusToAsanaCompleted,
  unlinkEntityFromAsanaTask
} from "@carbon/ee/asana.server";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";

const asana = getAsanaClient();

const ENTITY_TYPES = ["salesOrder", "quote", "salesRfq"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const parseEntityType = (value: string | null): EntityType | null => {
  return ENTITY_TYPES.includes(value as EntityType)
    ? (value as EntityType)
    : null;
};

export const action: ActionFunction = async ({ request }) => {
  try {
    const { companyId, client } = await requirePermissions(request, {});
    const form = await request.formData();

    const entityType = parseEntityType(form.get("entityType") as string | null);
    const entityId = form.get("entityId") as string;

    if (!entityType) {
      return data(
        { success: false, message: "Missing or invalid entityType" },
        { status: 400 }
      );
    }

    if (!entityId) {
      return data(
        { success: false, message: "Missing entityId" },
        { status: 400 }
      );
    }

    switch (request.method) {
      case "POST": {
        const projectGid = form.get("projectGid") as string;
        const readableId = form.get("readableId") as string;
        const customerName = form.get("customerName") as string;
        const status = form.get("status") as string;
        const notes = form.get("notes") as string;

        if (!projectGid) {
          return data(
            { success: false, message: "Missing projectGid" },
            { status: 400 }
          );
        }

        const { data: integrations } = await getAsanaIntegration(
          client,
          companyId
        );
        const integration = integrations?.[0];
        const metadata = integration?.metadata as { workspaceGid?: string };

        if (!metadata?.workspaceGid) {
          return data(
            { success: false, message: "Workspace not configured" },
            { status: 400 }
          );
        }

        const taskName = formatEntityTaskName(
          entityType,
          readableId,
          customerName,
          status || "Draft"
        );

        const task = await asana.createTask(companyId, {
          name: taskName,
          html_notes: notes ? `<body>${notes}</body>` : undefined,
          projects: [projectGid],
          completed: mapEntityStatusToAsanaCompleted(
            entityType,
            status || "Draft"
          ),
          workspace: metadata.workspaceGid
        });

        if (!task) {
          return data(
            { success: false, message: "Failed to create Asana task" },
            { status: 400 }
          );
        }

        await linkEntityToAsanaTask(client, companyId, {
          entityType,
          entityId,
          task
        });

        return { success: true, task };
      }

      case "PUT": {
        const status = form.get("status") as string;
        const readableId = form.get("readableId") as string;
        const customerName = form.get("customerName") as string;

        const existing = await getAsanaTaskFromExternalId(
          client,
          companyId,
          entityId,
          entityType
        );

        if (!existing) {
          return { success: true, message: "No linked Asana task" };
        }

        const taskName = formatEntityTaskName(
          entityType,
          readableId,
          customerName,
          status
        );

        await asana.updateTask(companyId, existing.gid, {
          name: taskName,
          completed: mapEntityStatusToAsanaCompleted(entityType, status)
        });

        return { success: true, message: "Asana task updated" };
      }

      case "DELETE": {
        await unlinkEntityFromAsanaTask(client, companyId, {
          entityType,
          entityId
        });

        return { success: true, message: "Unlinked successfully" };
      }
    }
  } catch (error) {
    console.error("Asana entity error:", error);
    return data(
      { success: false, message: "Failed to process request" },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const { companyId, client } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const entityType = parseEntityType(url.searchParams.get("entityType"));
  const entityId = url.searchParams.get("entityId");

  if (entityType && entityId) {
    const existing = await getAsanaTaskFromExternalId(
      client,
      companyId,
      entityId,
      entityType
    );
    return { linkedTask: existing ?? null };
  }

  const { data: integrations } = await getAsanaIntegration(client, companyId);
  const integration = integrations?.[0];
  const metadata = integration?.metadata as { workspaceGid?: string };

  if (!metadata?.workspaceGid) {
    return { projects: [] };
  }

  const projects = await asana.listProjects(companyId, metadata.workspaceGid);

  return { projects };
};
