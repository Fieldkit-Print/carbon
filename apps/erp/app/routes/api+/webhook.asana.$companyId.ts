import crypto from "node:crypto";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { syncTaskFromAsanaSchema } from "@carbon/jobs/trigger/asana";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { tasks } from "~/utils/tasks";
import { getIntegration } from "../../modules/settings";

export async function loader({ params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return { success: true };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;

  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  const serviceRole = getCarbonServiceRole();

  // Asana webhook handshake: echo back the X-Hook-Secret header
  const hookSecret = request.headers.get("X-Hook-Secret");
  if (hookSecret) {
    // Store the secret in the integration metadata for future verification
    const integration = await getIntegration(serviceRole, "asana", companyId);
    if (integration.data) {
      const metadata = (integration.data.metadata as Record<string, any>) ?? {};
      await serviceRole
        .from("companyIntegration")
        .update({
          metadata: { ...metadata, webhookSecret: hookSecret }
        })
        .eq("id", "asana")
        .eq("companyId", companyId);
    }

    return new Response(null, {
      status: 200,
      headers: { "X-Hook-Secret": hookSecret }
    });
  }

  // Verify integration is active
  const integration = await getIntegration(serviceRole, "asana", companyId);

  if (integration.error || !integration.data) {
    return data(
      { success: false, error: "Integration not configured" },
      { status: 400 }
    );
  }

  if (!integration.data.active) {
    return data(
      { success: false, error: "Integration not active" },
      { status: 400 }
    );
  }

  // Read raw body for HMAC verification
  const rawBody = await request.text();
  const signature = request.headers.get("X-Hook-Signature");
  const metadata = integration.data.metadata as Record<string, any>;
  const webhookSecret = metadata?.webhookSecret;

  // Verify signature if we have a stored secret
  if (webhookSecret && signature) {
    const hmac = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (hmac !== signature) {
      return data(
        { success: false, error: "Invalid signature" },
        { status: 401 }
      );
    }
  }

  let body: {
    events?: Array<{
      action: string;
      resource: { gid: string; resource_type: string };
    }>;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return data({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.events || body.events.length === 0) {
    return { success: true };
  }

  // Process task change events
  for (const event of body.events) {
    if (event.resource.resource_type !== "task") continue;
    if (event.action !== "changed") continue;

    const parsed = syncTaskFromAsanaSchema.safeParse({
      companyId,
      event: {
        resource: { gid: event.resource.gid },
        action: event.action
      }
    });

    if (!parsed.success) continue;

    try {
      await tasks.trigger("sync-task-from-asana", parsed.data);
    } catch (err) {
      console.error("Asana webhook: failed to trigger task", err);
    }
  }

  return { success: true };
}
