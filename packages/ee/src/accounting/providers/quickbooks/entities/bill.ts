import type { KyselyTx } from "@carbon/database/client";
import { createMappingService } from "../../../core/external-mapping";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { type QuickBooksProvider, throwQBApiError } from "../provider";
import type { QBBill, QBBillLine } from "../types";

type BillRow = {
  id: string;
  companyId: string;
  invoiceId: string;
  supplierId: string | null;
  status:
    | "Draft"
    | "Pending"
    | "Submitted"
    | "Return"
    | "Debit Note Issued"
    | "Paid"
    | "Partially Paid"
    | "Overdue"
    | "Voided";
  dateIssued: string | null;
  dateDue: string | null;
  datePaid: string | null;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  totalAmount: number;
  balance: number;
  supplierReference: string | null;
  updatedAt: string | null;
};

type BillLineRow = {
  id: string;
  invoiceId: string;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  itemId: string | null;
  accountNumber: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  totalAmount: number;
  purchaseOrderLineId: string | null;
  itemReadableIdWithRevision: string | null;
};

const SYNCABLE_STATUSES: Accounting.Bill["status"][] = [
  "Pending",
  "Submitted",
  "Partially Paid",
  "Paid",
  "Overdue"
];

export class QBBillSyncer extends BaseEntitySyncer<
  Accounting.Bill,
  QBBill,
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
    await txMappingService.link("bill", localId, this.provider.id, remoteId, {
      remoteUpdatedAt
    });

    await tx
      .updateTable("purchaseInvoice")
      .set({ updatedAt: new Date().toISOString() })
      .where("id", "=", localId)
      .execute();
  }

  protected getRemoteUpdatedAt(remote: QBBill): Date | null {
    return remote.MetaData?.LastUpdatedTime
      ? new Date(remote.MetaData.LastUpdatedTime)
      : null;
  }

  // =================================================================
  // LOCAL FETCH
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Bill | null> {
    const bills = await this.fetchBillsByIds([id]);
    return bills.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Bill>> {
    return this.fetchBillsByIds(ids);
  }

  private async fetchBillsByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Bill>> {
    if (ids.length === 0) return new Map();

    const billRows = await this.database
      .selectFrom("purchaseInvoice")
      .select([
        "purchaseInvoice.id",
        "purchaseInvoice.companyId",
        "purchaseInvoice.invoiceId",
        "purchaseInvoice.supplierId",
        "purchaseInvoice.status",
        "purchaseInvoice.dateIssued",
        "purchaseInvoice.dateDue",
        "purchaseInvoice.datePaid",
        "purchaseInvoice.currencyCode",
        "purchaseInvoice.exchangeRate",
        "purchaseInvoice.subtotal",
        "purchaseInvoice.totalTax",
        "purchaseInvoice.totalDiscount",
        "purchaseInvoice.totalAmount",
        "purchaseInvoice.balance",
        "purchaseInvoice.supplierReference",
        "purchaseInvoice.updatedAt"
      ])
      .where("purchaseInvoice.id", "in", ids)
      .where("purchaseInvoice.companyId", "=", this.companyId)
      .execute();

    if (billRows.length === 0) return new Map();

    const lineRows = await this.database
      .selectFrom("purchaseInvoiceLine")
      .leftJoin("item", "item.id", "purchaseInvoiceLine.itemId")
      .select([
        "purchaseInvoiceLine.id",
        "purchaseInvoiceLine.invoiceId",
        "purchaseInvoiceLine.description",
        "purchaseInvoiceLine.quantity",
        "purchaseInvoiceLine.unitPrice",
        "purchaseInvoiceLine.itemId",
        "purchaseInvoiceLine.accountNumber",
        "purchaseInvoiceLine.taxPercent",
        "purchaseInvoiceLine.taxAmount",
        "purchaseInvoiceLine.totalAmount",
        "purchaseInvoiceLine.purchaseOrderLineId",
        "item.readableIdWithRevision as itemReadableIdWithRevision"
      ])
      .where(
        "purchaseInvoiceLine.invoiceId",
        "in",
        billRows.map((r) => r.id)
      )
      .execute();

    const linesByBillId = new Map<string, BillLineRow[]>();
    for (const line of lineRows as BillLineRow[]) {
      const existing = linesByBillId.get(line.invoiceId) ?? [];
      existing.push(line);
      linesByBillId.set(line.invoiceId, existing);
    }

    const result = new Map<string, Accounting.Bill>();
    for (const row of billRows as BillRow[]) {
      const lines = linesByBillId.get(row.id) ?? [];

      result.set(row.id, {
        id: row.id,
        companyId: row.companyId,
        invoiceId: row.invoiceId,
        supplierId: row.supplierId,
        supplierExternalId: null,
        status: row.status,
        dateIssued: row.dateIssued,
        dateDue: row.dateDue,
        datePaid: row.datePaid,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        subtotal: Number(row.subtotal) || 0,
        totalTax: Number(row.totalTax) || 0,
        totalDiscount: Number(row.totalDiscount) || 0,
        totalAmount: Number(row.totalAmount) || 0,
        balance: Number(row.balance) || 0,
        supplierReference: row.supplierReference,
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: Number(line.quantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          itemId: line.itemId,
          itemCode: line.itemReadableIdWithRevision,
          accountNumber: line.accountNumber,
          taxPercent: Number(line.taxPercent) || 0,
          taxAmount: Number(line.taxAmount) || 0,
          totalAmount: Number(line.totalAmount) || 0,
          purchaseOrderLineId: line.purchaseOrderLineId
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

  async fetchRemote(id: string): Promise<QBBill | null> {
    const result = await this.qb.request<{ Bill: QBBill }>(
      "GET",
      `/bill/${id}`
    );
    return result.error ? null : (result.data?.Bill ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, QBBill>> {
    const result = new Map<string, QBBill>();
    if (ids.length === 0) return result;

    const idList = ids.map((id) => `'${id}'`).join(",");
    const response = await this.qb.query<QBBill>(
      `SELECT * FROM Bill WHERE Id IN (${idList})`
    );

    if (response.error) {
      throwQBApiError("fetch bills batch", response);
    }

    const bills = (response.data as any)?.Bill ?? [];
    for (const bill of bills) {
      result.set(bill.Id, bill);
    }

    return result;
  }

  // =================================================================
  // TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Bill
  ): Promise<Omit<QBBill, "SyncToken" | "Id">> {
    if (!local.supplierId) {
      throw new Error("Bill must have a supplier to sync to QuickBooks");
    }

    const vendorRemoteId = await this.ensureDependencySynced(
      "vendor",
      local.supplierId
    );

    const lines: QBBillLine[] = [];
    for (const line of local.lines) {
      const qbLine: QBBillLine = {
        Amount: line.totalAmount,
        DetailType: line.itemId
          ? "ItemBasedExpenseLineDetail"
          : "AccountBasedExpenseLineDetail"
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
      } else if (line.accountNumber) {
        qbLine.AccountBasedExpenseLineDetail = {
          AccountRef: { value: line.accountNumber }
        };
      }

      lines.push(qbLine);
    }

    return {
      DocNumber: local.invoiceId,
      VendorRef: { value: vendorRemoteId },
      TxnDate: local.dateIssued ?? undefined,
      DueDate: local.dateDue ?? undefined,
      Line: lines,
      CurrencyRef: { value: local.currencyCode },
      ExchangeRate: local.exchangeRate !== 1 ? local.exchangeRate : undefined
    };
  }

  // =================================================================
  // TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: QBBill
  ): Promise<Partial<Accounting.Bill>> {
    const lines: Accounting.BillLine[] = (remote.Line ?? []).map(
      (line, index) => ({
        id: line.Id ?? `line-${index}`,
        description: line.Description ?? null,
        quantity: line.ItemBasedExpenseLineDetail?.Qty ?? 1,
        unitPrice: line.ItemBasedExpenseLineDetail?.UnitPrice ?? line.Amount,
        itemId: null,
        itemCode: null,
        accountNumber:
          line.AccountBasedExpenseLineDetail?.AccountRef?.value ?? null,
        taxPercent: null,
        taxAmount: null,
        totalAmount: line.Amount,
        purchaseOrderLineId: null
      })
    );

    let status: Accounting.Bill["status"] = "Submitted";
    if (remote.Balance === 0 && (remote.TotalAmt ?? 0) > 0) {
      status = "Paid";
    } else if (
      remote.Balance !== undefined &&
      remote.TotalAmt !== undefined &&
      remote.Balance < remote.TotalAmt &&
      remote.Balance > 0
    ) {
      status = "Partially Paid";
    }

    return {
      status,
      dateIssued: remote.TxnDate ?? null,
      dateDue: remote.DueDate ?? null,
      subtotal: (remote.TotalAmt ?? 0) - (remote.TxnTaxDetail?.TotalTax ?? 0),
      totalTax: remote.TxnTaxDetail?.TotalTax ?? 0,
      totalAmount: remote.TotalAmt ?? 0,
      balance: remote.Balance ?? 0,
      currencyCode: remote.CurrencyRef?.value ?? "USD",
      exchangeRate: remote.ExchangeRate ?? 1,
      lines
    };
  }

  // =================================================================
  // UPSERT LOCAL
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Bill>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new bills from QuickBooks. Bill with remote ID ${remoteId} not found locally.`
      );
    }

    await tx
      .updateTable("purchaseInvoice")
      .set({
        status: data.status,
        dateIssued: data.dateIssued,
        dateDue: data.dateDue,
        subtotal: data.subtotal,
        totalTax: data.totalTax,
        totalAmount: data.totalAmount,
        balance: data.balance,
        currencyCode: data.currencyCode,
        exchangeRate: data.exchangeRate,
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
    data: Omit<QBBill, "SyncToken" | "Id">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      const current = await this.fetchRemote(existingRemoteId);
      if (!current) {
        throw new Error(
          `QuickBooks bill ${existingRemoteId} not found for update`
        );
      }

      const result = await this.qb.request<{ Bill: QBBill }>("POST", "/bill", {
        body: JSON.stringify({
          ...data,
          Id: existingRemoteId,
          SyncToken: current.SyncToken,
          sparse: true
        })
      });

      if (result.error) {
        throwQBApiError("update bill", result);
      }

      return result.data!.Bill.Id;
    }

    const result = await this.qb.request<{ Bill: QBBill }>("POST", "/bill", {
      body: JSON.stringify(data)
    });

    if (result.error) {
      throwQBApiError("create bill", result);
    }

    if (!result.data?.Bill?.Id) {
      throw new Error(
        "QuickBooks API returned success but no Bill Id was returned"
      );
    }

    return result.data.Bill.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<QBBill, "SyncToken" | "Id">;
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
    context: ShouldSyncContext<Accounting.Bill, QBBill>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Bill must be posted before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }
}
