import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getAsanaClient,
  getCompanyEmployees,
  linkActionToAsanaTask,
  linkEntityToAsanaTask
} from "@carbon/ee/asana.server";
import { task } from "@trigger.dev/sdk";
import { z } from "zod";

const asana = getAsanaClient();

export const syncTaskFromAsanaSchema = z.object({
  companyId: z.string(),
  event: z.object({
    resource: z.object({
      gid: z.string()
    }),
    action: z.string()
  })
});

export const syncTaskFromAsana = task({
  id: "sync-task-from-asana",
  retry: {
    maxAttempts: 1
  },
  maxDuration: 5 * 60,
  run: async (payload: z.infer<typeof syncTaskFromAsanaSchema>) => {
    console.info(`🔰 Asana webhook received`);
    console.info(`📦 Payload:`, payload);

    const carbon = getCarbonServiceRole();

    const [company, integration] = await Promise.all([
      carbon.from("company").select("*").eq("id", payload.companyId).single(),
      carbon
        .from("companyIntegration")
        .select("*")
        .eq("companyId", payload.companyId)
        .eq("id", "asana")
        .single()
    ]);

    if (company.error || !company.data) {
      throw new Error("Failed to fetch company from Carbon");
    }

    if (integration.error || !integration.data) {
      throw new Error("Failed to fetch integration from Carbon");
    }

    // Look up the mapping for this Asana task
    const mapping = await carbon
      .from("externalIntegrationMapping")
      .select("entityId, entityType")
      .eq("integration", "asana")
      .eq("externalId", payload.event.resource.gid)
      .eq("companyId", payload.companyId)
      .maybeSingle();

    if (!mapping.data) {
      return {
        success: false,
        message: `No linked entity found for Asana task ${payload.event.resource.gid}`
      };
    }

    // Fetch full task from Asana
    const fullTask = await asana.getTaskById(
      payload.companyId,
      payload.event.resource.gid
    );

    if (!fullTask) {
      return {
        success: false,
        message: `Failed to fetch task ${payload.event.resource.gid} from Asana`
      };
    }

    // Handle based on entity type
    if (mapping.data.entityType === "nonConformanceActionTask") {
      let assignee: string | null = null;

      if (fullTask.assignee?.email) {
        const employees = await getCompanyEmployees(carbon, payload.companyId, [
          fullTask.assignee.email
        ]);
        assignee = employees.length > 0 ? employees[0].userId : null;
      }

      const updated = await linkActionToAsanaTask(carbon, payload.companyId, {
        actionId: mapping.data.entityId,
        task: fullTask,
        assignee,
        syncNotes: true
      });

      if (!updated || updated.error) {
        return {
          success: false,
          message: `Failed to update action for Asana task ${payload.event.resource.gid}`
        };
      }
    } else if (
      mapping.data.entityType === "salesOrder" ||
      mapping.data.entityType === "quote" ||
      mapping.data.entityType === "salesRfq"
    ) {
      await linkEntityToAsanaTask(carbon, payload.companyId, {
        entityType: mapping.data.entityType,
        entityId: mapping.data.entityId,
        task: fullTask
      });
    }

    return {
      success: true,
      message: `Synced Asana task ${payload.event.resource.gid}`
    };
  }
});
