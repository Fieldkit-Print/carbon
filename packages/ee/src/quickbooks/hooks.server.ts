import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { CreateSubscriptionParams } from "@carbon/database/event";
import {
  createEventSystemSubscription,
  deleteEventSystemSubscriptionsByName
} from "@carbon/database/event";
import {
  getProviderIntegration,
  ProviderID,
  type ProviderIntegrationMetadata
} from "@carbon/ee/accounting";

export async function quickbooksHealthcheck(
  companyId: string,
  metadata: Record<string, unknown>
) {
  const provider = getProviderIntegration(
    getCarbonServiceRole(),
    companyId,
    ProviderID.QUICKBOOKS,
    metadata as ProviderIntegrationMetadata
  );

  return await provider.validate();
}

export async function quickbooksOnInstall(companyId: string) {
  const client = getCarbonServiceRole();

  const tables: CreateSubscriptionParams["table"][] = [
    "address",
    "customer",
    "supplier",
    "item",
    "salesInvoice",
    "purchaseInvoice",
    "purchaseOrder",
    "salesOrder"
  ];

  for (const table of tables) {
    await createEventSystemSubscription(client, {
      table,
      companyId,
      name: "quickbooks-sync",
      operations: ["INSERT", "UPDATE", "DELETE"],
      type: "SYNC",
      config: {
        provider: ProviderID.QUICKBOOKS
      }
    });
  }
}

export async function quickbooksOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  await deleteEventSystemSubscriptionsByName(
    client,
    companyId,
    "quickbooks-sync"
  );
}
