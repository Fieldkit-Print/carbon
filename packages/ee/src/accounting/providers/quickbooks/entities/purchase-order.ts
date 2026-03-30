import type { KyselyTx } from "@carbon/database/client";
import { createMappingService } from "../../../core/external-mapping";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { type QuickBooksProvider, throwQBApiError } from "../provider";
import type { QBPurchaseOrder, QBPurchaseOrderLine } from "../types";

type PORow = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  supplierId: string;
  status: string;
  orderDate: string | null;
  currencyCode: string | null;
  exchangeRate: number | null;
  supplierReference: string | null;
  updatedAt: string | null;
};

type POLineRow = {
  id: string;
  purchaseOrderId: string;
  description: string | null;
  purchaseQuantity: number;
  unitPrice: number;
  itemId: string | null;
  accountNumber: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  extendedPrice: number | null;
  quantityReceived: number | null;
  quantityInvoiced: number | null;
  itemCode: string | null;
};

// Only sync approved POs
const SYNCABLE_STATUSES: Accounting.PurchaseOrder["status"][] = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Closed"
];

export class QBPurchaseOrderSyncer extends BaseEntitySyncer<
  Accounting.PurchaseOrder,
  QBPurchaseOrder,
  "SyncToken" | "Id"
> {
  private get qb(): QuickBooksProvider {
    return this.provider as QuickBooksProvider;
  }

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      "purchaseOrder",
      localId,
      this.provider.id,
      remoteId,
      { remoteUpdatedAt }
    );
  }

  protected getRemoteUpdatedAt(remote: QBPurchaseOrder): Date | null {
    return remote.MetaData?.LastUpdatedTime
      ? new Date(remote.MetaData.LastUpdatedTime)
      : null;
  }

  // =================================================================
  // LOCAL FETCH
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.PurchaseOrder | null> {
    const pos = await this.fetchPOsByIds([id]);
    return pos.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.PurchaseOrder>> {
    return this.fetchPOsByIds(ids);
  }

  private async fetchPOsByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.PurchaseOrder>> {
    if (ids.length === 0) return new Map();

    const poRows = await this.database
      .selectFrom("purchaseOrder")
      .select([
        "purchaseOrder.id",
        "purchaseOrder.companyId",
        "purchaseOrder.purchaseOrderId",
        "purchaseOrder.supplierId",
        "purchaseOrder.status",
        "purchaseOrder.orderDate",
        "purchaseOrder.currencyCode",
        "purchaseOrder.exchangeRate",
        "purchaseOrder.supplierReference",
        "purchaseOrder.updatedAt"
      ])
      .where("purchaseOrder.id", "in", ids)
      .where("purchaseOrder.companyId", "=", this.companyId)
      .execute();

    if (poRows.length === 0) return new Map();

    const lineRows = await this.database
      .selectFrom("purchaseOrderLine")
      .leftJoin("item", "item.id", "purchaseOrderLine.itemId")
      .select([
        "purchaseOrderLine.id",
        "purchaseOrderLine.purchaseOrderId",
        "purchaseOrderLine.description",
        "purchaseOrderLine.purchaseQuantity",
        "purchaseOrderLine.unitPrice",
        "purchaseOrderLine.itemId",
        "purchaseOrderLine.accountNumber",
        "purchaseOrderLine.taxPercent",
        "purchaseOrderLine.taxAmount",
        "purchaseOrderLine.extendedPrice",
        "purchaseOrderLine.quantityReceived",
        "purchaseOrderLine.quantityInvoiced",
        "item.readableId as itemCode"
      ])
      .where(
        "purchaseOrderLine.purchaseOrderId",
        "in",
        poRows.map((r) => r.id)
      )
      .execute();

    const linesByPOId = new Map<string, POLineRow[]>();
    for (const line of lineRows as unknown as POLineRow[]) {
      const existing = linesByPOId.get(line.purchaseOrderId) ?? [];
      existing.push(line);
      linesByPOId.set(line.purchaseOrderId, existing);
    }

    const result = new Map<string, Accounting.PurchaseOrder>();
    for (const row of poRows as unknown as PORow[]) {
      const lines = linesByPOId.get(row.id) ?? [];

      // Calculate totals from lines (purchaseOrder table doesn't have subtotal/totalTax columns)
      let subtotal = 0;
      let totalTax = 0;
      for (const line of lines) {
        subtotal += Number(line.extendedPrice) || 0;
        totalTax += Number(line.taxAmount) || 0;
      }

      result.set(row.id, {
        id: row.id,
        companyId: row.companyId,
        purchaseOrderId: row.purchaseOrderId,
        supplierId: row.supplierId,
        supplierExternalId: null,
        status: row.status as Accounting.PurchaseOrder["status"],
        orderDate: row.orderDate,
        deliveryDate: null,
        deliveryAddress: null,
        deliveryInstructions: null,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        subtotal,
        totalTax,
        totalAmount: subtotal + totalTax,
        supplierReference: row.supplierReference,
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: Number(line.purchaseQuantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          itemId: line.itemId,
          itemCode: line.itemCode,
          accountNumber: line.accountNumber,
          taxPercent: Number(line.taxPercent) || 0,
          taxAmount: Number(line.taxAmount) || 0,
          totalAmount: Number(line.extendedPrice) || 0,
          quantityReceived: Number(line.quantityReceived) || 0,
          quantityInvoiced: Number(line.quantityInvoiced) || 0
        })),
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // REMOTE FETCH
  // =================================================================

  async fetchRemote(id: string): Promise<QBPurchaseOrder | null> {
    const result = await this.qb.request<{ PurchaseOrder: QBPurchaseOrder }>(
      "GET",
      `/purchaseorder/${id}`
    );
    return result.error ? null : (result.data?.PurchaseOrder ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, QBPurchaseOrder>> {
    const result = new Map<string, QBPurchaseOrder>();
    if (ids.length === 0) return result;

    const idList = ids.map((id) => `'${id}'`).join(",");
    const response = await this.qb.query<QBPurchaseOrder>(
      `SELECT * FROM PurchaseOrder WHERE Id IN (${idList})`
    );

    if (response.error) {
      throwQBApiError("fetch purchase orders batch", response);
    }

    const pos = (response.data as any)?.PurchaseOrder ?? [];
    for (const po of pos) {
      result.set(po.Id, po);
    }

    return result;
  }

  // =================================================================
  // TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.PurchaseOrder
  ): Promise<Omit<QBPurchaseOrder, "SyncToken" | "Id">> {
    const vendorRemoteId = await this.ensureDependencySynced(
      "vendor",
      local.supplierId
    );

    const lines: QBPurchaseOrderLine[] = [];
    for (const line of local.lines) {
      const qbLine: QBPurchaseOrderLine = {
        Amount: line.totalAmount,
        DetailType: "ItemBasedExpenseLineDetail"
      };

      if (line.description) {
        qbLine.Description = line.description;
      }

      if (line.itemId) {
        const itemRemoteId = await this.ensureDependencySynced(
          "item",
          line.itemId
        );
        qbLine.ItemBasedExpenseLineDetail = {
          ItemRef: { value: itemRemoteId },
          Qty: line.quantity,
          UnitPrice: line.unitPrice
        };
      } else {
        qbLine.ItemBasedExpenseLineDetail = {
          Qty: line.quantity,
          UnitPrice: line.unitPrice
        };
      }

      lines.push(qbLine);
    }

    return {
      DocNumber: local.purchaseOrderId,
      VendorRef: { value: vendorRemoteId },
      TxnDate: local.orderDate ?? undefined,
      Line: lines,
      CurrencyRef: local.currencyCode
        ? { value: local.currencyCode }
        : undefined,
      ExchangeRate:
        local.exchangeRate && local.exchangeRate !== 1
          ? local.exchangeRate
          : undefined
    };
  }

  // =================================================================
  // TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: QBPurchaseOrder
  ): Promise<Partial<Accounting.PurchaseOrder>> {
    return {
      status:
        remote.POStatus === "Closed" ? "Closed" : "To Receive and Invoice",
      orderDate: remote.TxnDate ?? null,
      totalAmount: remote.TotalAmt ?? 0,
      totalTax: remote.TxnTaxDetail?.TotalTax ?? 0,
      subtotal: (remote.TotalAmt ?? 0) - (remote.TxnTaxDetail?.TotalTax ?? 0),
      currencyCode: remote.CurrencyRef?.value ?? null,
      exchangeRate: remote.ExchangeRate ?? 1
    };
  }

  // =================================================================
  // UPSERT LOCAL
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    _data: Partial<Accounting.PurchaseOrder>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new purchase orders from QuickBooks. PO with remote ID ${remoteId} not found locally.`
      );
    }

    // The purchaseOrder table doesn't store totals — they are computed from lines.
    // We can update currency and exchange rate if needed.
    await tx
      .updateTable("purchaseOrder")
      .set({
        currencyCode: _data.currencyCode,
        exchangeRate: _data.exchangeRate,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", existingLocalId)
      .execute();

    return existingLocalId;
  }

  // =================================================================
  // UPSERT REMOTE
  // =================================================================

  protected async upsertRemote(
    data: Omit<QBPurchaseOrder, "SyncToken" | "Id">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      const current = await this.fetchRemote(existingRemoteId);
      if (!current) {
        throw new Error(
          `QuickBooks PO ${existingRemoteId} not found for update`
        );
      }

      const result = await this.qb.request<{
        PurchaseOrder: QBPurchaseOrder;
      }>("POST", "/purchaseorder", {
        body: JSON.stringify({
          ...data,
          Id: existingRemoteId,
          SyncToken: current.SyncToken,
          sparse: true
        })
      });

      if (result.error) {
        throwQBApiError("update purchase order", result);
      }

      return result.data!.PurchaseOrder.Id;
    }

    const result = await this.qb.request<{
      PurchaseOrder: QBPurchaseOrder;
    }>("POST", "/purchaseorder", {
      body: JSON.stringify(data)
    });

    if (result.error) {
      throwQBApiError("create purchase order", result);
    }

    if (!result.data?.PurchaseOrder?.Id) {
      throw new Error(
        "QuickBooks API returned success but no PurchaseOrder Id was returned"
      );
    }

    return result.data.PurchaseOrder.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<QBPurchaseOrder, "SyncToken" | "Id">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    for (const { localId, payload } of data) {
      const remoteId = await this.upsertRemote(payload, localId);
      result.set(localId, remoteId);
    }

    return result;
  }

  protected shouldSync(
    context: ShouldSyncContext<Accounting.PurchaseOrder, QBPurchaseOrder>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `PO must be approved before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }
}
