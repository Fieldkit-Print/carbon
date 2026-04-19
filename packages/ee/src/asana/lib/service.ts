import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAsanaClient } from "./client";
import { htmlToTiptap } from "./richtext";
import { AsanaTaskSchema } from "./types";
import { mapAsanaStatusToCarbonStatus } from "./utils";

export async function getAsanaIntegration(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", "asana")
    .limit(1);
}

export async function linkActionToAsanaTask(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    actionId: string;
    task: z.infer<typeof AsanaTaskSchema>;
    assignee?: string | null;
    syncNotes?: boolean;
  }
) {
  const { data, success } = AsanaTaskSchema.safeParse(input.task);

  if (!success) return null;

  // Convert Asana HTML notes to Tiptap format
  let notes: any = undefined;
  if (input.syncNotes && data.html_notes) {
    try {
      notes = htmlToTiptap(data.html_notes);
    } catch (e) {
      console.error("Failed to convert Asana HTML to Tiptap:", e);
    }
  }

  const updateData: Record<string, any> = {
    assignee: input.assignee,
    status: mapAsanaStatusToCarbonStatus(data.completed),
    dueDate: data.due_on
  };

  if (notes !== undefined) {
    updateData.notes = notes;
  }

  const result = await client
    .from("nonConformanceActionTask")
    .update(updateData)
    .eq("companyId", companyId)
    .eq("id", input.actionId)
    .select("nonConformanceId");

  // Upsert the Asana mapping in externalIntegrationMapping
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "nonConformanceActionTask")
    .eq("entityId", input.actionId)
    .eq("integration", "asana");

  await client.from("externalIntegrationMapping").insert({
    entityType: "nonConformanceActionTask",
    entityId: input.actionId,
    integration: "asana",
    externalId: data.gid,
    metadata: data as any,
    companyId
  });

  return result;
}

export async function unlinkActionFromAsanaTask(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    actionId: string;
  }
) {
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "nonConformanceActionTask")
    .eq("entityId", input.actionId)
    .eq("integration", "asana");

  return client
    .from("nonConformanceActionTask")
    .select("nonConformanceId")
    .eq("companyId", companyId)
    .eq("id", input.actionId);
}

export const getAsanaTaskFromExternalId = async (
  client: SupabaseClient<Database>,
  companyId: string,
  entityId: string,
  entityType: string = "nonConformanceActionTask"
) => {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("metadata, externalId")
    .eq("entityType", entityType)
    .eq("entityId", entityId)
    .eq("integration", "asana")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping) return null;

  const { data } = AsanaTaskSchema.safeParse(mapping.metadata);
  if (!data) return null;

  return data;
};

export async function linkEntityToAsanaTask(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    entityType: "salesOrder" | "quote" | "salesRfq";
    entityId: string;
    task: z.infer<typeof AsanaTaskSchema>;
  }
) {
  const { data, success } = AsanaTaskSchema.safeParse(input.task);
  if (!success) return null;

  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", input.entityType)
    .eq("entityId", input.entityId)
    .eq("integration", "asana");

  await client.from("externalIntegrationMapping").insert({
    entityType: input.entityType,
    entityId: input.entityId,
    integration: "asana",
    externalId: data.gid,
    metadata: data as any,
    companyId
  });

  return data;
}

export async function unlinkEntityFromAsanaTask(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    entityType: "salesOrder" | "quote" | "salesRfq";
    entityId: string;
  }
) {
  const serviceRole = getCarbonServiceRole();
  return serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", input.entityType)
    .eq("entityId", input.entityId)
    .eq("integration", "asana");
}

/**
 * Reconciles the Asana webhook subscription for a company's issues project.
 *
 * Asana webhooks are created via POST /webhooks with a handshake: Asana calls
 * back to the target URL with an X-Hook-Secret header that our endpoint echoes
 * and persists. Because that handshake runs inside the createWebhook call, we
 * re-fetch metadata afterwards so we don't overwrite the stored secret when
 * we persist the webhook gid.
 */
export async function setupAsanaIssuesWebhook(
  companyId: string,
  webhookUrl: string
): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  const { data: integrations } = await getAsanaIntegration(
    serviceRole,
    companyId
  );
  const integration = integrations?.[0];
  if (!integration) return;

  const metadata = (integration.metadata as Record<string, any>) ?? {};
  const targetResource = metadata.issuesProjectGid as string | undefined;
  const existingGid = metadata.webhookGid as string | undefined;
  const existingResource = metadata.webhookResourceGid as string | undefined;

  const asana = getAsanaClient();

  // Resource unchanged — nothing to do
  if (targetResource && existingGid && existingResource === targetResource) {
    return;
  }

  // Remove stale subscription when resource changed or project was cleared
  if (existingGid) {
    await asana.deleteWebhook(companyId, existingGid);
    const { data: refreshed } = await getAsanaIntegration(
      serviceRole,
      companyId
    );
    const refreshedMetadata =
      (refreshed?.[0]?.metadata as Record<string, any>) ?? {};
    const {
      webhookGid: _g,
      webhookResourceGid: _r,
      ...rest
    } = refreshedMetadata;
    await serviceRole
      .from("companyIntegration")
      .update({ metadata: rest })
      .eq("id", "asana")
      .eq("companyId", companyId);
  }

  if (!targetResource) return;

  const created = await asana.createWebhook(companyId, {
    resource: targetResource,
    target: webhookUrl
  });

  if (!created) return;

  // Re-fetch so we pick up webhookSecret written by the handshake handler
  const { data: after } = await getAsanaIntegration(serviceRole, companyId);
  const afterMetadata = (after?.[0]?.metadata as Record<string, any>) ?? {};

  await serviceRole
    .from("companyIntegration")
    .update({
      metadata: {
        ...afterMetadata,
        webhookGid: created.gid,
        webhookResourceGid: targetResource
      }
    })
    .eq("id", "asana")
    .eq("companyId", companyId);
}

export async function teardownAsanaWebhook(companyId: string): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  const { data: integrations } = await getAsanaIntegration(
    serviceRole,
    companyId
  );
  const integration = integrations?.[0];
  if (!integration) return;

  const metadata = (integration.metadata as Record<string, any>) ?? {};
  const existingGid = metadata.webhookGid as string | undefined;
  if (!existingGid) return;

  const asana = getAsanaClient();
  await asana.deleteWebhook(companyId, existingGid);

  const {
    webhookGid: _g,
    webhookResourceGid: _r,
    webhookSecret: _s,
    ...rest
  } = metadata;
  await serviceRole
    .from("companyIntegration")
    .update({ metadata: rest })
    .eq("id", "asana")
    .eq("companyId", companyId);
}

export const getCompanyEmployees = async (
  client: SupabaseClient<Database>,
  companyId: string,
  emails: string[]
) => {
  const users = await client
    .from("userToCompany")
    .select("userId,user(email)")
    .eq("companyId", companyId)
    .eq("role", "employee")
    .in("user.email", emails);

  return users.data ?? [];
};

// Re-export the type for use in service.ts (zod infer needs the import)
import type { z } from "zod";
