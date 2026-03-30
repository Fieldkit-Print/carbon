import type { KyselyTx } from "@carbon/database/client";
import { createMappingService } from "../../../core/external-mapping";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { type QuickBooksProvider, throwQBApiError } from "../provider";
import type { QBInvoice, QBInvoiceLine } from "../types";

type InvoiceRow = {
  id: string;
  invoiceId: string;
  companyId: string;
  customerId: string;
  status:
    | "Draft"
    | "Pending"
    | "Submitted"
    | "Partially Paid"
    | "Paid"
    | "Overdue"
    | "Voided"
    | "Credit Note Issued"
    | "Return";
  currencyCode: string;
  exchangeRate: number;
  dateIssued: string | null;
  dateDue: string | null;
  datePaid: string | null;
  customerReference: string | null;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  totalAmount: number;
  balance: number;
  updatedAt: string | null;
};

type InvoiceLineRow = {
  id: string;
  invoiceId: string;
  invoiceLineType: string;
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  itemReadableIdWithRevision: string | null;
};

// Only sync posted invoices
const SYNCABLE_STATUSES: Accounting.SalesInvoice["status"][] = [
  "Pending",
  "Submitted",
  "Partially Paid",
  "Paid",
  "Overdue"
];

export class QBSalesInvoiceSyncer extends BaseEntitySyncer<
  Accounting.SalesInvoice,
  QBInvoice,
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
      "invoice",
      localId,
      this.provider.id,
      remoteId,
      { remoteUpdatedAt }
    );

    await tx
      .updateTable("salesInvoice")
      .set({ updatedAt: new Date().toISOString() })
      .where("id", "=", localId)
      .execute();
  }

  protected getRemoteUpdatedAt(remote: QBInvoice): Date | null {
    return remote.MetaData?.LastUpdatedTime
      ? new Date(remote.MetaData.LastUpdatedTime)
      : null;
  }

  // =================================================================
  // LOCAL FETCH
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.SalesInvoice | null> {
    const invoices = await this.fetchInvoicesByIds([id]);
    return invoices.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesInvoice>> {
    return this.fetchInvoicesByIds(ids);
  }

  private async fetchInvoicesByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.SalesInvoice>> {
    if (ids.length === 0) return new Map();

    const invoiceRows = await this.database
      .selectFrom("salesInvoice")
      .select([
        "salesInvoice.id",
        "salesInvoice.invoiceId",
        "salesInvoice.companyId",
        "salesInvoice.customerId",
        "salesInvoice.status",
        "salesInvoice.currencyCode",
        "salesInvoice.exchangeRate",
        "salesInvoice.dateIssued",
        "salesInvoice.dateDue",
        "salesInvoice.datePaid",
        "salesInvoice.customerReference",
        "salesInvoice.subtotal",
        "salesInvoice.totalTax",
        "salesInvoice.totalDiscount",
        "salesInvoice.totalAmount",
        "salesInvoice.balance",
        "salesInvoice.updatedAt"
      ])
      .where("salesInvoice.id", "in", ids)
      .where("salesInvoice.companyId", "=", this.companyId)
      .execute();

    if (invoiceRows.length === 0) return new Map();

    const lineRows = await this.database
      .selectFrom("salesInvoiceLine")
      .leftJoin("item", "item.id", "salesInvoiceLine.itemId")
      .select([
        "salesInvoiceLine.id",
        "salesInvoiceLine.invoiceId",
        "salesInvoiceLine.invoiceLineType",
        "salesInvoiceLine.itemId",
        "salesInvoiceLine.description",
        "salesInvoiceLine.quantity",
        "salesInvoiceLine.unitPrice",
        "salesInvoiceLine.taxPercent",
        "item.readableIdWithRevision as itemReadableIdWithRevision"
      ])
      .where(
        "salesInvoiceLine.invoiceId",
        "in",
        invoiceRows.map((r) => r.id)
      )
      .execute();

    const linesByInvoiceId = new Map<string, InvoiceLineRow[]>();
    for (const line of lineRows as InvoiceLineRow[]) {
      const existing = linesByInvoiceId.get(line.invoiceId) ?? [];
      existing.push(line);
      linesByInvoiceId.set(line.invoiceId, existing);
    }

    const result = new Map<string, Accounting.SalesInvoice>();
    for (const row of invoiceRows as InvoiceRow[]) {
      const lines = linesByInvoiceId.get(row.id) ?? [];

      result.set(row.id, {
        id: row.id,
        invoiceId: row.invoiceId,
        companyId: row.companyId,
        customerId: row.customerId,
        customerExternalId: null,
        status: row.status,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        dateIssued: row.dateIssued,
        dateDue: row.dateDue,
        datePaid: row.datePaid,
        customerReference: row.customerReference,
        subtotal: Number(row.subtotal) || 0,
        totalTax: Number(row.totalTax) || 0,
        totalDiscount: Number(row.totalDiscount) || 0,
        totalAmount: Number(row.totalAmount) || 0,
        balance: Number(row.balance) || 0,
        lines: lines.map((line) => {
          const quantity = Number(line.quantity) || 0;
          const unitPrice = Number(line.unitPrice) || 0;
          return {
            id: line.id,
            invoiceLineType: line.invoiceLineType,
            itemId: line.itemId,
            itemCode: line.itemReadableIdWithRevision,
            description: line.description,
            quantity,
            unitPrice,
            taxPercent: Number(line.taxPercent) || 0,
            lineAmount: quantity * unitPrice
          };
        }),
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // REMOTE FETCH
  // =================================================================

  async fetchRemote(id: string): Promise<QBInvoice | null> {
    const result = await this.qb.request<{ Invoice: QBInvoice }>(
      "GET",
      `/invoice/${id}`
    );
    return result.error ? null : (result.data?.Invoice ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, QBInvoice>> {
    const result = new Map<string, QBInvoice>();
    if (ids.length === 0) return result;

    const idList = ids.map((id) => `'${id}'`).join(",");
    const response = await this.qb.query<QBInvoice>(
      `SELECT * FROM Invoice WHERE Id IN (${idList})`
    );

    if (response.error) {
      throwQBApiError("fetch invoices batch", response);
    }

    const invoices = (response.data as any)?.Invoice ?? [];
    for (const invoice of invoices) {
      result.set(invoice.Id, invoice);
    }

    return result;
  }

  // =================================================================
  // TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.SalesInvoice
  ): Promise<Omit<QBInvoice, "SyncToken" | "Id">> {
    // Ensure customer is synced
    const customerRemoteId = await this.ensureDependencySynced(
      "customer",
      local.customerId
    );

    // Build line items
    const lines: QBInvoiceLine[] = [];
    for (const line of local.lines) {
      const qbLine: QBInvoiceLine = {
        Amount: line.quantity * line.unitPrice,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          Qty: line.quantity,
          UnitPrice: line.unitPrice
        }
      };

      if (line.description) {
        qbLine.Description = line.description;
      }

      // If line has an item, ensure it's synced and set the ItemRef
      if (line.itemId) {
        const itemRemoteId = await this.ensureDependencySynced(
          "item",
          line.itemId
        );
        qbLine.SalesItemLineDetail!.ItemRef = {
          value: itemRemoteId
        };
      }

      lines.push(qbLine);
    }

    return {
      DocNumber: local.invoiceId,
      CustomerRef: { value: customerRemoteId },
      TxnDate: local.dateIssued ?? undefined,
      DueDate: local.dateDue ?? undefined,
      Line: lines,
      CurrencyRef: { value: local.currencyCode },
      ExchangeRate: local.exchangeRate !== 1 ? local.exchangeRate : undefined,
      CustomerMemo: local.customerReference
        ? { value: local.customerReference }
        : undefined
    };
  }

  // =================================================================
  // TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: QBInvoice
  ): Promise<Partial<Accounting.SalesInvoice>> {
    // Map QBO line items
    const lines: Accounting.SalesInvoiceLine[] = (remote.Line ?? [])
      .filter((line) => line.DetailType === "SalesItemLineDetail")
      .map((line, index) => ({
        id: line.Id ?? `line-${index}`,
        invoiceLineType: "Part",
        itemId: null,
        itemCode: null,
        description: line.Description ?? null,
        quantity: line.SalesItemLineDetail?.Qty ?? 0,
        unitPrice: line.SalesItemLineDetail?.UnitPrice ?? 0,
        taxPercent: 0,
        lineAmount: line.Amount
      }));

    // Determine Carbon status from QBO balance
    let status: Accounting.SalesInvoice["status"] = "Submitted";
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
      customerReference: remote.CustomerMemo?.value ?? null,
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
    data: Partial<Accounting.SalesInvoice>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new invoices from QuickBooks. Invoice with remote ID ${remoteId} not found locally.`
      );
    }

    await tx
      .updateTable("salesInvoice")
      .set({
        status: data.status,
        dateIssued: data.dateIssued,
        dateDue: data.dateDue,
        customerReference: data.customerReference,
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
    data: Omit<QBInvoice, "SyncToken" | "Id">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      const current = await this.fetchRemote(existingRemoteId);
      if (!current) {
        throw new Error(
          `QuickBooks invoice ${existingRemoteId} not found for update`
        );
      }

      const result = await this.qb.request<{ Invoice: QBInvoice }>(
        "POST",
        "/invoice",
        {
          body: JSON.stringify({
            ...data,
            Id: existingRemoteId,
            SyncToken: current.SyncToken,
            sparse: true
          })
        }
      );

      if (result.error) {
        throwQBApiError("update invoice", result);
      }

      return result.data!.Invoice.Id;
    }

    const result = await this.qb.request<{ Invoice: QBInvoice }>(
      "POST",
      "/invoice",
      { body: JSON.stringify(data) }
    );

    if (result.error) {
      throwQBApiError("create invoice", result);
    }

    if (!result.data?.Invoice?.Id) {
      throw new Error(
        "QuickBooks API returned success but no Invoice Id was returned"
      );
    }

    return result.data.Invoice.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<QBInvoice, "SyncToken" | "Id">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    for (const { localId, payload } of data) {
      const remoteId = await this.upsertRemote(payload, localId);
      result.set(localId, remoteId);
    }

    return result;
  }

  // =================================================================
  // SHOULD SYNC
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<Accounting.SalesInvoice, QBInvoice>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Invoice must be posted before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }
}
