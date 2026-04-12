/**
 * Backfill task for syncing entities between Carbon and accounting providers.
 *
 * This task respects the per-entity sync direction configuration:
 * - "pull-from-accounting": Only pull entities from the provider
 * - "push-to-accounting": Only push Carbon entities to the provider
 * - "two-way": Pull from provider AND push unsynced Carbon entities
 *
 * Phase 1: Master data (customers, vendors, items) — no dependencies
 * Phase 2: Transactions (invoices, bills, purchase orders) — depend on master data
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool,
} from "@carbon/database/client";
import {
  createMappingService,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  RatelimitError,
  SyncFactory,
  type AccountingEntityType,
  type QuickBooksProvider,
  type SyncDirection,
  type XeroProvider,
} from "@carbon/ee/accounting";
import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { PostgresDriver } from "kysely";
import z from "zod";

// ============================================================
// HELPERS
// ============================================================

/**
 * Execute an async operation with rate limit handling.
 * If a RatelimitError is thrown, wait for the specified retry period and retry once.
 */
async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RatelimitError) {
      const { retryAfterSeconds, limitType, details } = error.rateLimitInfo;
      logger.warn(`[RATE LIMIT] ${operationName} hit rate limit`, {
        limitType,
        retryAfterSeconds,
        ...details,
      });
      await wait.for({ seconds: retryAfterSeconds });
      logger.info(
        `[RATE LIMIT] Retrying ${operationName} after ${retryAfterSeconds}s wait`
      );
      return await operation();
    }
    throw error;
  }
}

/** Map push entity table names to accounting entity types */
const PUSH_ENTITY_MAP: Record<string, AccountingEntityType> = {
  customer: "customer",
  supplier: "vendor",
  item: "item",
  salesInvoice: "invoice",
  purchaseInvoice: "bill",
  purchaseOrder: "purchaseOrder",
};

/** Map accounting entity types to DB table names for getUnsyncedEntityIds */
const ENTITY_TABLE_MAP: Record<string, string> = {
  customer: "customer",
  vendor: "supplier",
  item: "item",
  invoice: "salesInvoice",
  bill: "purchaseInvoice",
  purchaseOrder: "purchaseOrder",
};

// ============================================================
// SCHEMAS
// ============================================================

const BackfillPayloadSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  batchSize: z.number().default(25), // Smaller batches to avoid rate limits
  entityTypes: z
    .object({
      customers: z.boolean().default(true),
      vendors: z.boolean().default(true),
      items: z.boolean().default(true),
      invoices: z.boolean().default(true),
      bills: z.boolean().default(true),
      purchaseOrders: z.boolean().default(true),
    })
    .default({}),
});

/**
 * Helper to determine if we should pull for a given direction config
 */
function shouldPull(direction: SyncDirection): boolean {
  return direction === "pull-from-accounting" || direction === "two-way";
}

/**
 * Helper to determine if we should push for a given direction config
 */
function shouldPush(direction: SyncDirection): boolean {
  return direction === "push-to-accounting" || direction === "two-way";
}

const PullPagePayloadSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  entityType: z.enum([
    "contact",
    "customer",
    "vendor",
    "item",
    "invoice",
    "bill",
    "purchaseOrder",
  ]),
  page: z.number(),
  // Only used for Xero's combined "contact" entity type
  includeCustomers: z.boolean().optional().default(true),
  includeVendors: z.boolean().optional().default(true),
});

const PushBatchPayloadSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  entityType: z.enum([
    "customer",
    "supplier",
    "item",
    "salesInvoice",
    "purchaseInvoice",
    "purchaseOrder",
  ]),
  entityIds: z.array(z.string()),
});

export type BackfillPayload = z.input<typeof BackfillPayloadSchema>;
type ParsedBackfillPayload = z.output<typeof BackfillPayloadSchema>;

// ============================================================
// PULL PAGE TASK - Pulls a single page from external system
// ============================================================

export const accountingPullPageTask = task({
  id: "accounting-pull-page",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 120000, // Up to 2 minutes for rate limit recovery
    randomize: true,
  },
  run: async (input: z.input<typeof PullPagePayloadSchema>) => {
    const payload = PullPagePayloadSchema.parse(input);
    const client = getCarbonServiceRole();

    const integration = await getAccountingIntegration(
      client,
      payload.companyId,
      payload.provider
    );

    const provider = getProviderIntegration(
      client,
      payload.companyId,
      integration.id,
      integration.metadata
    );

    const pool = getPostgresConnectionPool(5);
    const kysely = getPostgresClient(pool, PostgresDriver);

    try {
      // ── Xero: combined contact endpoint ──
      if (payload.entityType === "contact") {
        const xero = provider as XeroProvider;
        logger.info(`[PULL] Fetching contacts page ${payload.page}`);
        const response = await withRateLimitRetry(
          () =>
            xero.listContacts({
              page: payload.page,
              summaryOnly: true,
            }),
          `listContacts page ${payload.page}`
        );

        logger.info(`[PULL] Contacts page ${payload.page} response`, {
          count: response.contacts.length,
          hasMore: response.hasMore,
          contacts: response.contacts.map((c) => ({
            id: c.ContactID,
            name: c.Name,
            isCustomer: c.IsCustomer,
            isSupplier: c.IsSupplier,
          })),
        });

        if (response.contacts.length === 0) {
          return { hasMore: false, pulled: { customers: 0, vendors: 0 } };
        }

        let customersPulled = 0;
        let vendorsPulled = 0;

        // Pull customers
        if (payload.includeCustomers) {
          const customers = response.contacts.filter((c) => c.IsCustomer);
          if (customers.length > 0) {
            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId: payload.companyId,
              provider,
              config: provider.getSyncConfig("customer"),
              entityType: "customer",
            });
            const ids = customers.map((c) => c.ContactID);
            const result = await withRateLimitRetry(
              () => syncer.pullBatchFromAccounting(ids),
              `pullBatchFromAccounting customers page ${payload.page}`
            );
            customersPulled = result.successCount;
            logger.info(
              `[PULL] Page ${payload.page}: pulled ${customersPulled} customers`,
              {
                results: result.results.map((r) => ({
                  status: r.status,
                  action: r.action,
                  localId: r.localId,
                  remoteId: r.remoteId,
                  error: r.error,
                })),
              }
            );
          }
        }

        // Pull vendors
        if (payload.includeVendors) {
          const vendors = response.contacts.filter((c) => c.IsSupplier);
          if (vendors.length > 0) {
            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId: payload.companyId,
              provider,
              config: provider.getSyncConfig("vendor"),
              entityType: "vendor",
            });
            const ids = vendors.map((c) => c.ContactID);
            const result = await withRateLimitRetry(
              () => syncer.pullBatchFromAccounting(ids),
              `pullBatchFromAccounting vendors page ${payload.page}`
            );
            vendorsPulled = result.successCount;
            logger.info(
              `[PULL] Page ${payload.page}: pulled ${vendorsPulled} vendors`,
              {
                results: result.results.map((r) => ({
                  status: r.status,
                  action: r.action,
                  localId: r.localId,
                  remoteId: r.remoteId,
                  error: r.error,
                })),
              }
            );
          }
        }

        return {
          hasMore: response.hasMore,
          pulled: { customers: customersPulled, vendors: vendorsPulled },
        };
      }

      // ── Xero: items ──
      if (payload.entityType === "item" && payload.provider === ProviderID.XERO) {
        const xero = provider as XeroProvider;
        logger.info(`[PULL] Fetching items page ${payload.page}`);
        const response = await withRateLimitRetry(
          () => xero.listItems({ page: payload.page }),
          `listItems page ${payload.page}`
        );

        logger.info(`[PULL] Items page ${payload.page} response`, {
          count: response.items.length,
          hasMore: response.hasMore,
          items: response.items.map((i) => ({
            id: i.ItemID,
            code: i.Code,
            name: i.Name,
          })),
        });

        if (response.items.length === 0) {
          return { hasMore: false, pulled: { items: 0 } };
        }

        const syncer = SyncFactory.getSyncer({
          database: kysely,
          companyId: payload.companyId,
          provider,
          config: provider.getSyncConfig("item"),
          entityType: "item",
        });
        const ids = response.items.map((item) => item.ItemID);
        const result = await withRateLimitRetry(
          () => syncer.pullBatchFromAccounting(ids),
          `pullBatchFromAccounting items page ${payload.page}`
        );

        logger.info(
          `[PULL] Page ${payload.page}: pulled ${result.successCount} items`,
          {
            results: result.results.map((r) => ({
              status: r.status,
              action: r.action,
              localId: r.localId,
              remoteId: r.remoteId,
              error: r.error,
            })),
          }
        );

        return {
          hasMore: response.hasMore,
          pulled: { items: result.successCount },
        };
      }

      // ── QuickBooks: individual entity types ──
      const qb = provider as QuickBooksProvider;

      type ListResult = { ids: string[]; hasMore: boolean };

      const fetchPage = async (): Promise<ListResult> => {
        switch (payload.entityType) {
          case "customer": {
            const res = await withRateLimitRetry(
              () => qb.listCustomers(payload.page),
              `listCustomers page ${payload.page}`
            );
            return {
              ids: res.customers.map((c) => c.Id),
              hasMore: res.hasMore,
            };
          }
          case "vendor": {
            const res = await withRateLimitRetry(
              () => qb.listVendors(payload.page),
              `listVendors page ${payload.page}`
            );
            return {
              ids: res.vendors.map((v) => v.Id),
              hasMore: res.hasMore,
            };
          }
          case "item": {
            const res = await withRateLimitRetry(
              () => qb.listItems(payload.page),
              `listItems page ${payload.page}`
            );
            return {
              ids: res.items.map((i) => i.Id),
              hasMore: res.hasMore,
            };
          }
          case "invoice": {
            const res = await withRateLimitRetry(
              () => qb.listInvoices(payload.page),
              `listInvoices page ${payload.page}`
            );
            return {
              ids: res.invoices.map((i) => i.Id),
              hasMore: res.hasMore,
            };
          }
          case "bill": {
            const res = await withRateLimitRetry(
              () => qb.listBills(payload.page),
              `listBills page ${payload.page}`
            );
            return {
              ids: res.bills.map((b) => b.Id),
              hasMore: res.hasMore,
            };
          }
          case "purchaseOrder": {
            const res = await withRateLimitRetry(
              () => qb.listPurchaseOrders(payload.page),
              `listPurchaseOrders page ${payload.page}`
            );
            return {
              ids: res.purchaseOrders.map((po) => po.Id),
              hasMore: res.hasMore,
            };
          }
          default:
            throw new Error(
              `Unsupported entity type: ${payload.entityType}`
            );
        }
      };

      // Map entity types to accounting entity types for SyncFactory
      const PULL_ENTITY_MAP: Record<string, AccountingEntityType> = {
        customer: "customer",
        vendor: "vendor",
        item: "item",
        invoice: "invoice",
        bill: "bill",
        purchaseOrder: "purchaseOrder",
      };

      const accountingEntityType = PULL_ENTITY_MAP[payload.entityType];
      if (!accountingEntityType) {
        throw new Error(
          `No accounting entity mapping for: ${payload.entityType}`
        );
      }

      logger.info(
        `[PULL] Fetching ${payload.entityType} page ${payload.page}`
      );

      const { ids, hasMore } = await fetchPage();

      if (ids.length === 0) {
        return {
          hasMore: false,
          pulled: { [payload.entityType]: 0 },
        };
      }

      const syncer = SyncFactory.getSyncer({
        database: kysely,
        companyId: payload.companyId,
        provider,
        config: provider.getSyncConfig(accountingEntityType),
        entityType: accountingEntityType,
      });

      const result = await withRateLimitRetry(
        () => syncer.pullBatchFromAccounting(ids),
        `pullBatchFromAccounting ${payload.entityType} page ${payload.page}`
      );

      logger.info(
        `[PULL] Page ${payload.page}: pulled ${result.successCount} ${payload.entityType}`,
        {
          results: result.results.map((r) => ({
            status: r.status,
            action: r.action,
            localId: r.localId,
            remoteId: r.remoteId,
            error: r.error,
          })),
        }
      );

      return {
        hasMore,
        pulled: { [payload.entityType]: result.successCount },
      };
    } finally {
      await pool.end();
    }
  },
});

// ============================================================
// PUSH BATCH TASK - Pushes a batch of entities to external system
// ============================================================

export const accountingPushBatchTask = task({
  id: "accounting-push-batch",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 120000,
    randomize: true,
  },
  run: async (input: z.input<typeof PushBatchPayloadSchema>) => {
    const payload = PushBatchPayloadSchema.parse(input);
    const client = getCarbonServiceRole();

    const integration = await getAccountingIntegration(
      client,
      payload.companyId,
      payload.provider
    );

    const provider = getProviderIntegration(
      client,
      payload.companyId,
      integration.id,
      integration.metadata
    );

    const pool = getPostgresConnectionPool(5);
    const kysely = getPostgresClient(pool, PostgresDriver);

    try {
      const entityType: AccountingEntityType =
        PUSH_ENTITY_MAP[payload.entityType] ??
        (payload.entityType as AccountingEntityType);

      const syncer = SyncFactory.getSyncer({
        database: kysely,
        companyId: payload.companyId,
        provider,
        config: provider.getSyncConfig(entityType),
        entityType,
      });

      const result = await withRateLimitRetry(
        () => syncer.pushBatchToAccounting(payload.entityIds),
        `pushBatchToAccounting ${payload.entityType}`
      );

      logger.info(
        `[PUSH] Pushed ${result.successCount}/${payload.entityIds.length} ${payload.entityType} entities`,
        {
          entityIds: payload.entityIds,
          results: result.results.map((r) => ({
            status: r.status,
            action: r.action,
            localId: r.localId,
            remoteId: r.remoteId,
            error: r.error,
          })),
        }
      );

      return {
        successCount: result.successCount,
        errorCount: result.errorCount,
      };
    } finally {
      await pool.end();
    }
  },
});

// ============================================================
// ORCHESTRATOR TASK - Coordinates the entire backfill process
// ============================================================

export const accountingBackfillTask = task({
  id: "accounting-backfill",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60000,
    randomize: true,
  },
  run: async (input: BackfillPayload) => {
    const payload: ParsedBackfillPayload = BackfillPayloadSchema.parse(input);
    const client = getCarbonServiceRole();

    const integration = await getAccountingIntegration(
      client,
      payload.companyId,
      payload.provider
    );

    const provider = getProviderIntegration(
      client,
      payload.companyId,
      integration.id,
      integration.metadata
    );

    // Get sync direction config for each entity type
    const customerConfig = provider.getSyncConfig("customer");
    const vendorConfig = provider.getSyncConfig("vendor");
    const itemConfig = provider.getSyncConfig("item");
    const invoiceConfig = provider.getSyncConfig("invoice");
    const billConfig = provider.getSyncConfig("bill");
    const purchaseOrderConfig = provider.getSyncConfig("purchaseOrder");

    const result = {
      customers: { pulled: 0, pushed: 0 },
      vendors: { pulled: 0, pushed: 0 },
      items: { pulled: 0, pushed: 0 },
      invoices: { pulled: 0, pushed: 0 },
      bills: { pulled: 0, pushed: 0 },
      purchaseOrders: { pulled: 0, pushed: 0 },
      totalPulled: 0,
      totalPushed: 0,
    };

    // Log the sync directions for visibility
    logger.info("[BACKFILL] Starting with entity sync directions:", {
      customer: {
        enabled: customerConfig?.enabled,
        direction: customerConfig?.direction,
        shouldPull:
          customerConfig?.enabled && shouldPull(customerConfig.direction),
        shouldPush:
          customerConfig?.enabled && shouldPush(customerConfig.direction),
      },
      vendor: {
        enabled: vendorConfig?.enabled,
        direction: vendorConfig?.direction,
        shouldPull: vendorConfig?.enabled && shouldPull(vendorConfig.direction),
        shouldPush: vendorConfig?.enabled && shouldPush(vendorConfig.direction),
      },
      item: {
        enabled: itemConfig?.enabled,
        direction: itemConfig?.direction,
        shouldPull: itemConfig?.enabled && shouldPull(itemConfig.direction),
        shouldPush: itemConfig?.enabled && shouldPush(itemConfig.direction),
      },
      invoice: {
        enabled: invoiceConfig?.enabled,
        direction: invoiceConfig?.direction,
        shouldPull:
          invoiceConfig?.enabled && shouldPull(invoiceConfig.direction),
        shouldPush:
          invoiceConfig?.enabled && shouldPush(invoiceConfig.direction),
      },
      bill: {
        enabled: billConfig?.enabled,
        direction: billConfig?.direction,
        shouldPull: billConfig?.enabled && shouldPull(billConfig.direction),
        shouldPush: billConfig?.enabled && shouldPush(billConfig.direction),
      },
      purchaseOrder: {
        enabled: purchaseOrderConfig?.enabled,
        direction: purchaseOrderConfig?.direction,
        shouldPull:
          purchaseOrderConfig?.enabled &&
          shouldPull(purchaseOrderConfig.direction),
        shouldPush:
          purchaseOrderConfig?.enabled &&
          shouldPush(purchaseOrderConfig.direction),
      },
    });

    // ============================================================
    // PHASE 1: MASTER DATA (customers, vendors, items)
    // ============================================================

    // ── Pull master data ──

    if (payload.provider === ProviderID.XERO) {
      // Xero: combined contact endpoint
      const pullCustomers =
        payload.entityTypes.customers &&
        customerConfig?.enabled &&
        shouldPull(customerConfig.direction);

      const pullVendors =
        payload.entityTypes.vendors &&
        vendorConfig?.enabled &&
        shouldPull(vendorConfig.direction);

      if (pullCustomers || pullVendors) {
        let page = 1;
        let hasMore = true;

        logger.info("[PULL] Starting contact pull phase (Xero)", {
          pullCustomers,
          pullVendors,
        });

        while (hasMore) {
          const pullResult = await accountingPullPageTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "contact",
            page,
            includeCustomers: pullCustomers,
            includeVendors: pullVendors,
          });

          if (pullResult.ok) {
            result.customers.pulled +=
              pullResult.output.pulled.customers ?? 0;
            result.vendors.pulled += pullResult.output.pulled.vendors ?? 0;
            hasMore = pullResult.output.hasMore;
          } else {
            logger.error(`[PULL] Failed to pull contacts page ${page}`);
            hasMore = false;
          }

          page++;

          if (hasMore) {
            await wait.for({ seconds: 1 });
          }
        }
      } else {
        logger.info(
          "[PULL] Skipping contact pull - not enabled or direction is push-only"
        );
      }
    } else {
      // QuickBooks: separate customer and vendor endpoints
      const pullCustomers =
        payload.entityTypes.customers &&
        customerConfig?.enabled &&
        shouldPull(customerConfig.direction);

      if (pullCustomers) {
        let page = 1;
        let hasMore = true;

        logger.info("[PULL] Starting customer pull phase (QuickBooks)");

        while (hasMore) {
          const pullResult = await accountingPullPageTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "customer",
            page,
          });

          if (pullResult.ok) {
            result.customers.pulled +=
              pullResult.output.pulled.customer ?? 0;
            hasMore = pullResult.output.hasMore;
          } else {
            logger.error(`[PULL] Failed to pull customers page ${page}`);
            hasMore = false;
          }

          page++;

          if (hasMore) {
            await wait.for({ seconds: 1 });
          }
        }
      }

      const pullVendors =
        payload.entityTypes.vendors &&
        vendorConfig?.enabled &&
        shouldPull(vendorConfig.direction);

      if (pullVendors) {
        let page = 1;
        let hasMore = true;

        logger.info("[PULL] Starting vendor pull phase (QuickBooks)");

        while (hasMore) {
          const pullResult = await accountingPullPageTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "vendor",
            page,
          });

          if (pullResult.ok) {
            result.vendors.pulled += pullResult.output.pulled.vendor ?? 0;
            hasMore = pullResult.output.hasMore;
          } else {
            logger.error(`[PULL] Failed to pull vendors page ${page}`);
            hasMore = false;
          }

          page++;

          if (hasMore) {
            await wait.for({ seconds: 1 });
          }
        }
      }
    }

    // Pull items (both Xero and QuickBooks)
    const pullItems =
      payload.entityTypes.items &&
      itemConfig?.enabled &&
      shouldPull(itemConfig.direction);

    if (pullItems) {
      let page = 1;
      let hasMore = true;

      logger.info("[PULL] Starting items pull phase");

      while (hasMore) {
        const pullResult = await accountingPullPageTask.triggerAndWait({
          companyId: payload.companyId,
          provider: payload.provider,
          entityType: "item",
          page,
        });

        if (pullResult.ok) {
          result.items.pulled +=
            pullResult.output.pulled.items ??
            pullResult.output.pulled.item ??
            0;
          hasMore = pullResult.output.hasMore;
        } else {
          logger.error(`[PULL] Failed to pull items page ${page}`);
          hasMore = false;
        }

        page++;

        if (hasMore) {
          await wait.for({ seconds: 1 });
        }
      }
    } else {
      logger.info(
        "[PULL] Skipping items pull - not enabled or direction is push-only"
      );
    }

    // ── Push master data ──

    const pool = getPostgresConnectionPool(5);
    const kysely = getPostgresClient(pool, PostgresDriver);

    try {
      const mappingService = createMappingService(kysely, payload.companyId);

      // Push customers
      const pushCustomers =
        payload.entityTypes.customers &&
        customerConfig?.enabled &&
        shouldPush(customerConfig.direction);

      if (pushCustomers) {
        let hasMore = true;

        logger.info("[PUSH] Starting customers push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "customer",
            "customer",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "customer",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.customers.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push customers batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
          "[PUSH] Skipping customers push - not enabled or direction is pull-only"
        );
      }

      // Push vendors
      const pushVendors =
        payload.entityTypes.vendors &&
        vendorConfig?.enabled &&
        shouldPush(vendorConfig.direction);

      if (pushVendors) {
        let hasMore = true;

        logger.info("[PUSH] Starting vendors push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "vendor",
            "supplier",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "supplier",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.vendors.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push vendors batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
          "[PUSH] Skipping vendors push - not enabled or direction is pull-only"
        );
      }

      // Push items
      const pushItems =
        payload.entityTypes.items &&
        itemConfig?.enabled &&
        shouldPush(itemConfig.direction);

      if (pushItems) {
        let hasMore = true;

        logger.info("[PUSH] Starting items push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "item",
            "item",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "item",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.items.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push items batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
          "[PUSH] Skipping items push - not enabled or direction is pull-only"
        );
      }

      // ============================================================
      // PHASE 2: TRANSACTIONS (invoices, bills, purchase orders)
      // Depend on master data being synced first.
      // ============================================================

      // ── Pull transactions ──

      const pullInvoices =
        payload.entityTypes.invoices &&
        invoiceConfig?.enabled &&
        shouldPull(invoiceConfig.direction);

      if (pullInvoices) {
        let page = 1;
        let hasMore = true;

        logger.info("[PULL] Starting invoices pull phase");

        while (hasMore) {
          const pullResult = await accountingPullPageTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "invoice",
            page,
          });

          if (pullResult.ok) {
            result.invoices.pulled +=
              pullResult.output.pulled.invoice ?? 0;
            hasMore = pullResult.output.hasMore;
          } else {
            logger.error(`[PULL] Failed to pull invoices page ${page}`);
            hasMore = false;
          }

          page++;

          if (hasMore) {
            await wait.for({ seconds: 1 });
          }
        }
      } else {
        logger.info(
          "[PULL] Skipping invoices pull - not enabled or direction is push-only"
        );
      }

      const pullBills =
        payload.entityTypes.bills &&
        billConfig?.enabled &&
        shouldPull(billConfig.direction);

      if (pullBills) {
        let page = 1;
        let hasMore = true;

        logger.info("[PULL] Starting bills pull phase");

        while (hasMore) {
          const pullResult = await accountingPullPageTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "bill",
            page,
          });

          if (pullResult.ok) {
            result.bills.pulled += pullResult.output.pulled.bill ?? 0;
            hasMore = pullResult.output.hasMore;
          } else {
            logger.error(`[PULL] Failed to pull bills page ${page}`);
            hasMore = false;
          }

          page++;

          if (hasMore) {
            await wait.for({ seconds: 1 });
          }
        }
      } else {
        logger.info(
          "[PULL] Skipping bills pull - not enabled or direction is push-only"
        );
      }

      const pullPurchaseOrders =
        payload.entityTypes.purchaseOrders &&
        purchaseOrderConfig?.enabled &&
        shouldPull(purchaseOrderConfig.direction);

      if (pullPurchaseOrders) {
        let page = 1;
        let hasMore = true;

        logger.info("[PULL] Starting purchase orders pull phase");

        while (hasMore) {
          const pullResult = await accountingPullPageTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "purchaseOrder",
            page,
          });

          if (pullResult.ok) {
            result.purchaseOrders.pulled +=
              pullResult.output.pulled.purchaseOrder ?? 0;
            hasMore = pullResult.output.hasMore;
          } else {
            logger.error(
              `[PULL] Failed to pull purchase orders page ${page}`
            );
            hasMore = false;
          }

          page++;

          if (hasMore) {
            await wait.for({ seconds: 1 });
          }
        }
      } else {
        logger.info(
          "[PULL] Skipping purchase orders pull - not enabled or direction is push-only"
        );
      }

      // ── Push transactions ──

      const pushInvoices =
        payload.entityTypes.invoices &&
        invoiceConfig?.enabled &&
        shouldPush(invoiceConfig.direction);

      if (pushInvoices) {
        let hasMore = true;

        logger.info("[PUSH] Starting invoices push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "invoice",
            "salesInvoice",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "salesInvoice",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.invoices.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push invoices batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
          "[PUSH] Skipping invoices push - not enabled or direction is pull-only"
        );
      }

      const pushBills =
        payload.entityTypes.bills &&
        billConfig?.enabled &&
        shouldPush(billConfig.direction);

      if (pushBills) {
        let hasMore = true;

        logger.info("[PUSH] Starting bills push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "bill",
            "purchaseInvoice",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "purchaseInvoice",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.bills.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push bills batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
          "[PUSH] Skipping bills push - not enabled or direction is pull-only"
        );
      }

      const pushPurchaseOrders =
        payload.entityTypes.purchaseOrders &&
        purchaseOrderConfig?.enabled &&
        shouldPush(purchaseOrderConfig.direction);

      if (pushPurchaseOrders) {
        let hasMore = true;

        logger.info("[PUSH] Starting purchase orders push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "purchaseOrder",
            "purchaseOrder",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "purchaseOrder",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.purchaseOrders.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push purchase orders batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
          "[PUSH] Skipping purchase orders push - not enabled or direction is pull-only"
        );
      }
    } finally {
      await pool.end();
    }

    // Calculate totals
    result.totalPulled =
      result.customers.pulled +
      result.vendors.pulled +
      result.items.pulled +
      result.invoices.pulled +
      result.bills.pulled +
      result.purchaseOrders.pulled;
    result.totalPushed =
      result.customers.pushed +
      result.vendors.pushed +
      result.items.pushed +
      result.invoices.pushed +
      result.bills.pushed +
      result.purchaseOrders.pushed;

    logger.info(
      `[COMPLETE] Backfill finished. Pulled: ${result.totalPulled}, Pushed: ${result.totalPushed}`
    );

    return result;
  },
});
