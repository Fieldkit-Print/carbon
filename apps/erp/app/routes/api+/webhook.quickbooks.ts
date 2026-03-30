/**
 * QuickBooks Online Webhook Handler
 *
 * Receives webhook notifications from QBO when entities
 * (customers, vendors, invoices, bills, etc.) are created or updated.
 *
 * QBO webhook payload format:
 * {
 *   "eventNotifications": [{
 *     "realmId": "123456",
 *     "dataChangeEvent": {
 *       "entities": [{
 *         "name": "Customer",
 *         "id": "1",
 *         "operation": "Create",
 *         "lastUpdated": "2026-03-30T12:00:00.000Z"
 *       }]
 *     }
 *   }]
 * }
 */

import { QUICKBOOKS_WEBHOOK_SECRET } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type {
  AccountingEntity,
  AccountingSyncPayload
} from "@carbon/ee/accounting";
import { getAccountingIntegration, ProviderID } from "@carbon/ee/accounting";
import { tasks } from "@trigger.dev/sdk/v3";
import crypto from "crypto";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

export const config = {
  runtime: "nodejs"
};

const QBEntitySchema = z.object({
  name: z.string(),
  id: z.string(),
  operation: z.enum(["Create", "Update", "Delete", "Merge", "Void"]),
  lastUpdated: z.string()
});

const QBWebhookSchema = z.object({
  eventNotifications: z.array(
    z.object({
      realmId: z.string(),
      dataChangeEvent: z.object({
        entities: z.array(QBEntitySchema)
      })
    })
  )
});

function verifySignature(payload: string, signature: string): boolean {
  if (!QUICKBOOKS_WEBHOOK_SECRET) {
    console.warn("QUICKBOOKS_WEBHOOK_SECRET is not configured");
    return false;
  }

  const hmac = crypto
    .createHmac("sha256", QUICKBOOKS_WEBHOOK_SECRET)
    .update(payload, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Map QBO entity names to Carbon accounting entity types
function mapEntityType(
  qbEntityName: string
): AccountingEntity["entityType"] | null {
  switch (qbEntityName) {
    case "Customer":
      return "customer";
    case "Vendor":
      return "vendor";
    case "Item":
      return "item";
    case "Invoice":
      return "invoice";
    case "Bill":
      return "bill";
    case "PurchaseOrder":
    case "Purchase Order":
      return "purchaseOrder";
    case "Payment":
      return "payment";
    default:
      return null;
  }
}

function mapOperation(qbOperation: string): AccountingEntity["operation"] {
  switch (qbOperation) {
    case "Create":
      return "create";
    case "Update":
      return "update";
    case "Delete":
    case "Void":
      return "delete";
    case "Merge":
      return "update";
    default:
      return "sync";
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const payloadText = await request.text();

  // Verify webhook signature
  if (QUICKBOOKS_WEBHOOK_SECRET) {
    const signature = request.headers.get("intuit-signature");

    if (!signature) {
      return data(
        { success: false, error: "Missing signature" },
        { status: 401 }
      );
    }

    const isValid = verifySignature(payloadText, signature);

    if (!isValid) {
      return data(
        { success: false, error: "Invalid signature" },
        { status: 401 }
      );
    }
  }

  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return data(
      { success: false, error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const parsed = QBWebhookSchema.safeParse(payload);

  if (!parsed.success) {
    console.error("Invalid QuickBooks webhook payload:", parsed.error);
    return data(
      { success: false, error: "Invalid payload format" },
      { status: 400 }
    );
  }

  console.log(
    "Processing QuickBooks webhook with",
    parsed.data.eventNotifications.length,
    "notifications"
  );

  const serviceRole = getCarbonServiceRole();
  const syncJobs = [];
  const errors = [];

  for (const notification of parsed.data.eventNotifications) {
    const { realmId, dataChangeEvent } = notification;

    try {
      const integration = await getAccountingIntegration(
        serviceRole,
        realmId,
        ProviderID.QUICKBOOKS
      );

      if (!integration) {
        console.error(`No QuickBooks integration found for realm ${realmId}`);
        errors.push({ realmId, error: "Realm ID not found in integrations" });
        continue;
      }

      const companyId = integration.companyId;

      const entities: Array<AccountingEntity> = [];

      for (const entity of dataChangeEvent.entities) {
        const entityType = mapEntityType(entity.name);

        if (!entityType) {
          console.log(`Skipping unsupported entity type: ${entity.name}`);
          continue;
        }

        const operation = mapOperation(entity.operation);

        console.log(
          `QuickBooks ${operation}: ${entity.name} ${entity.id} (realm: ${realmId})`
        );

        entities.push({
          entityType,
          entityId: entity.id,
          operation
        });
      }

      if (entities.length > 0) {
        try {
          const syncPayload: AccountingSyncPayload = {
            companyId,
            provider: ProviderID.QUICKBOOKS,
            syncType: "webhook",
            syncDirection: "pull-from-accounting",
            entities,
            metadata: {
              tenantId: realmId,
              raw: parsed.data
            }
          };

          const handle = await tasks.trigger(
            "sync-external-accounting",
            syncPayload,
            {
              tags: [ProviderID.QUICKBOOKS, syncPayload.syncType],
              concurrencyKey: `sync-external-accounting:${companyId}`
            }
          );

          console.log(
            `Triggered accounting sync job ${handle.id} for ${entities.length} entities`
          );

          syncJobs.push({
            id: handle.id,
            companyId,
            realmId,
            entityCount: entities.length
          });
        } catch (error) {
          console.error("Failed to trigger sync job:", error);
          errors.push({
            realmId,
            error:
              error instanceof Error ? error.message : "Failed to trigger job"
          });
        }
      }
    } catch (error) {
      console.error("Error processing events for realm:", realmId, error);
      errors.push({
        realmId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  console.log(
    `Processed QuickBooks webhook: ${syncJobs.length} sync jobs triggered`
  );

  return {
    success: errors.length === 0,
    jobsTriggered: syncJobs.length,
    jobs: syncJobs,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString()
  };
}
