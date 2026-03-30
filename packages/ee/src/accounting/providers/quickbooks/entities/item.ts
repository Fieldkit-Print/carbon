import type { KyselyTx } from "@carbon/database/client";
import { type Accounting, BaseEntitySyncer } from "../../../core/types";
import { type QuickBooksProvider, throwQBApiError } from "../provider";
import type { QBItem } from "../types";

type ItemRow = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  description: string | null;
  companyId: string | null;
  type: "Part" | "Material" | "Tool" | "Consumable" | "Fixture";
  unitOfMeasureCode: string | null;
  replenishmentSystem: "Buy" | "Make" | "Buy and Make";
  itemTrackingType: string;
  updatedAt: string | null;
  unitCost: number | null;
  unitSalePrice: number | null;
};

export class QBItemSyncer extends BaseEntitySyncer<
  Accounting.Item,
  QBItem,
  "SyncToken" | "Id"
> {
  private get qb(): QuickBooksProvider {
    return this.provider as QuickBooksProvider;
  }

  protected getRemoteUpdatedAt(remote: QBItem): Date | null {
    return remote.MetaData?.LastUpdatedTime
      ? new Date(remote.MetaData.LastUpdatedTime)
      : null;
  }

  // =================================================================
  // LOCAL FETCH
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Item | null> {
    const items = await this.fetchItemsByIds([id]);
    return items.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Item>> {
    return this.fetchItemsByIds(ids);
  }

  private async fetchItemsByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Item>> {
    if (ids.length === 0) return new Map();

    const rows = await this.database
      .selectFrom("item")
      .leftJoin("itemCost", "itemCost.itemId", "item.id")
      .leftJoin("itemUnitSalePrice", "itemUnitSalePrice.itemId", "item.id")
      .select([
        "item.id",
        "item.readableId",
        "item.readableIdWithRevision",
        "item.name",
        "item.description",
        "item.companyId",
        "item.type",
        "item.unitOfMeasureCode",
        "item.replenishmentSystem",
        "item.itemTrackingType",
        "item.updatedAt",
        "itemCost.unitCost",
        "itemUnitSalePrice.unitSalePrice"
      ])
      .where("item.id", "in", ids)
      .where("item.companyId", "=", this.companyId)
      .execute();

    const result = new Map<string, Accounting.Item>();

    for (const row of rows as ItemRow[]) {
      const isPurchased =
        row.replenishmentSystem === "Buy" ||
        row.replenishmentSystem === "Buy and Make";

      result.set(row.id, {
        id: row.id,
        code: row.readableIdWithRevision ?? row.readableId,
        name: row.name,
        description: row.description,
        companyId: row.companyId!,
        type: row.type,
        unitOfMeasureCode: row.unitOfMeasureCode,
        unitCost: Number(row.unitCost) || 0,
        unitSalePrice: Number(row.unitSalePrice) || 0,
        isPurchased,
        isSold: true,
        isTrackedAsInventory: row.itemTrackingType !== "None",
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // REMOTE FETCH
  // =================================================================

  async fetchRemote(id: string): Promise<QBItem | null> {
    const result = await this.qb.request<{ Item: QBItem }>(
      "GET",
      `/item/${id}`
    );
    return result.error ? null : (result.data?.Item ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, QBItem>> {
    const result = new Map<string, QBItem>();
    if (ids.length === 0) return result;

    const idList = ids.map((id) => `'${id}'`).join(",");
    const response = await this.qb.query<QBItem>(
      `SELECT * FROM Item WHERE Id IN (${idList})`
    );

    if (response.error) {
      throwQBApiError("fetch items batch", response);
    }

    const items = (response.data as any)?.Item ?? [];
    for (const item of items) {
      result.set(item.Id, item);
    }

    return result;
  }

  // =================================================================
  // TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Item
  ): Promise<Omit<QBItem, "SyncToken" | "Id">> {
    const qbProvider = this.provider as QuickBooksProvider;
    const defaultSalesAccountCode =
      qbProvider.settings?.defaultSalesAccountCode;
    const defaultPurchaseAccountCode =
      qbProvider.settings?.defaultPurchaseAccountCode;

    const itemType: QBItem["Type"] = local.isTrackedAsInventory
      ? "Inventory"
      : local.isPurchased || local.isSold
        ? "NonInventory"
        : "Service";

    return {
      Name: local.name.slice(0, 100),
      Description: local.description?.slice(0, 4000) ?? undefined,
      Type: itemType,
      Active: true,
      UnitPrice: local.unitSalePrice,
      PurchaseCost: local.unitCost,
      Sku: local.code.slice(0, 100),
      IncomeAccountRef: defaultSalesAccountCode
        ? { value: defaultSalesAccountCode }
        : undefined,
      ExpenseAccountRef: defaultPurchaseAccountCode
        ? { value: defaultPurchaseAccountCode }
        : undefined
    };
  }

  // =================================================================
  // TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: QBItem
  ): Promise<Partial<Accounting.Item>> {
    return {
      code: remote.Sku ?? remote.Name,
      name: remote.Name,
      description: remote.Description ?? null,
      unitCost: remote.PurchaseCost ?? 0,
      unitSalePrice: remote.UnitPrice ?? 0,
      isPurchased: remote.Type !== "Service",
      isSold: true,
      isTrackedAsInventory: remote.Type === "Inventory"
    };
  }

  // =================================================================
  // UPSERT LOCAL
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Item>,
    remoteId: string
  ): Promise<string> {
    let existingLocalId = await this.getLocalId(remoteId);

    // Smart match by item code
    if (!existingLocalId && data.code) {
      const match = await tx
        .selectFrom("item")
        .select("id")
        .where("companyId", "=", this.companyId)
        .where((eb) =>
          eb.or([
            eb("readableIdWithRevision" as any, "=", data.code!),
            eb("readableId", "=", data.code!)
          ])
        )
        .executeTakeFirst();
      existingLocalId = match?.id ?? null;
    }

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new items from QuickBooks. Item with remote ID ${remoteId} (code: ${data.code ?? "unknown"}) not found locally.`
      );
    }

    await tx
      .updateTable("item")
      .set({
        name: data.name,
        description: data.description,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", existingLocalId)
      .execute();

    if (data.unitCost !== undefined) {
      await tx
        .updateTable("itemCost")
        .set({ unitCost: data.unitCost })
        .where("itemId", "=", existingLocalId)
        .execute();
    }

    if (data.unitSalePrice !== undefined) {
      await tx
        .updateTable("itemUnitSalePrice")
        .set({ unitSalePrice: data.unitSalePrice })
        .where("itemId", "=", existingLocalId)
        .execute();
    }

    return existingLocalId;
  }

  // =================================================================
  // UPSERT REMOTE
  // =================================================================

  protected async upsertRemote(
    data: Omit<QBItem, "SyncToken" | "Id">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      const current = await this.fetchRemote(existingRemoteId);
      if (!current) {
        throw new Error(
          `QuickBooks item ${existingRemoteId} not found for update`
        );
      }

      const result = await this.qb.request<{ Item: QBItem }>("POST", "/item", {
        body: JSON.stringify({
          ...data,
          Id: existingRemoteId,
          SyncToken: current.SyncToken,
          sparse: true
        })
      });

      if (result.error) {
        throwQBApiError("update item", result);
      }

      return result.data!.Item.Id;
    }

    const result = await this.qb.request<{ Item: QBItem }>("POST", "/item", {
      body: JSON.stringify(data)
    });

    if (result.error) {
      throwQBApiError("create item", result);
    }

    if (!result.data?.Item?.Id) {
      throw new Error(
        "QuickBooks API returned success but no Item Id was returned"
      );
    }

    return result.data.Item.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<QBItem, "SyncToken" | "Id">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    for (const { localId, payload } of data) {
      const remoteId = await this.upsertRemote(payload, localId);
      result.set(localId, remoteId);
    }

    return result;
  }
}
