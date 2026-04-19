import { getUser } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatEntityTaskName,
  getAsanaClient,
  getAsanaTaskFromExternalId,
  mapCarbonStatusToAsanaCompleted,
  mapEntityStatusToAsanaCompleted,
  tiptapToHtml
} from "../../asana/lib/index.server";
import type { TiptapDocument } from "../../asana/lib/richtext";
import type { NotificationEvent, NotificationService } from "../types";

const asana = getAsanaClient();

/**
 * Asana Notification Service
 * Updates Asana tasks based on Carbon notification events
 */
export class AsanaNotificationService implements NotificationService {
  id = "asana";
  name = "Asana";

  async send(
    event: NotificationEvent,
    context: { serviceRole: SupabaseClient<Database> }
  ): Promise<void> {
    switch (event.type) {
      case "task.status.changed": {
        if (
          !event.data.type ||
          !["action", "investigation"].includes(event.data.type)
        )
          return;

        const task = await getAsanaTaskFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!task) return;

        await asana.updateTask(event.companyId, task.gid, {
          completed: mapCarbonStatusToAsanaCompleted(event.data.status)
        });

        break;
      }

      case "task.assigned": {
        if (event.data.table !== "nonConformanceActionTask") return;

        const task = await getAsanaTaskFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!task) return;

        const { data: user } = await getUser(
          context.serviceRole,
          event.data.assignee
        );

        if (!user) return;

        // Find matching Asana user by email in the workspace
        const { data: integration } = await context.serviceRole
          .from("companyIntegration")
          .select("metadata")
          .eq("companyId", event.companyId)
          .eq("id", "asana")
          .maybeSingle();

        const workspaceGid = (integration?.metadata as any)?.workspaceGid;
        if (!workspaceGid) return;

        const asanaUsers = await asana.getWorkspaceUsers(
          event.companyId,
          workspaceGid
        );
        const asanaUser = asanaUsers.find((u) => u.email === user.email);

        if (!asanaUser) return;

        await asana.updateTask(event.companyId, task.gid, {
          assignee: asanaUser.gid
        });
        break;
      }

      case "task.notes.changed": {
        if (event.data.table !== "nonConformanceActionTask") return;

        const task = await getAsanaTaskFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!task) return;

        const notes = event.data.notes as TiptapDocument | null | undefined;
        if (!notes) return;

        try {
          const html_notes = tiptapToHtml(notes);

          await asana.updateTask(event.companyId, task.gid, {
            html_notes
          });
        } catch (e) {
          console.error("Failed to sync notes to Asana:", e);
        }
        break;
      }

      case "entity.status.changed": {
        const task = await getAsanaTaskFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id,
          event.data.entityType
        );

        if (!task) return;

        await asana.updateTask(event.companyId, task.gid, {
          name: formatEntityTaskName(
            event.data.entityType,
            event.data.readableId,
            event.data.customerName,
            event.data.status
          ),
          completed: mapEntityStatusToAsanaCompleted(
            event.data.entityType,
            event.data.status
          )
        });
        break;
      }
    }
  }
}
