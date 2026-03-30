import type { KyselyTx } from "@carbon/database/client";
import { type Accounting, BaseEntitySyncer } from "../../../core/types";
import { type QuickBooksProvider, throwQBApiError } from "../provider";
import type { QBCustomer, QBVendor } from "../types";

type EntityRow = {
  id: string;
  name: string;
  companyId: string;
  taxId: string | null;
  phone: string | null;
  fax: string | null;
  website: string | null;
  currencyCode: string | null;
  updatedAt: string | null;
  locationName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  contactMobilePhone: string | null;
  contactHomePhone: string | null;
  contactWorkPhone: string | null;
};

// ============================================================================
// Customer Syncer
// ============================================================================

export class CustomerSyncer extends BaseEntitySyncer<
  Accounting.Contact,
  QBCustomer,
  "SyncToken" | "Id"
> {
  private get qb(): QuickBooksProvider {
    return this.provider as QuickBooksProvider;
  }

  // =================================================================
  // 1. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: QBCustomer): Date | null {
    return remote.MetaData?.LastUpdatedTime
      ? new Date(remote.MetaData.LastUpdatedTime)
      : null;
  }

  // =================================================================
  // 2. LOCAL FETCH
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Contact | null> {
    const results = await this.fetchCustomersByIds([id]);
    return results.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();
    return this.fetchCustomersByIds(ids);
  }

  private async fetchCustomersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();

    const rows = await this.database
      .selectFrom("customer")
      .leftJoin(
        "customerLocation",
        "customerLocation.customerId",
        "customer.id"
      )
      .leftJoin("address", "address.id", "customerLocation.addressId")
      .leftJoin("customerContact", "customerContact.customerId", "customer.id")
      .leftJoin("contact", "contact.id", "customerContact.contactId")
      .select([
        "customer.id",
        "customer.name",
        "customer.companyId",
        "customer.taxId",
        "customer.phone",
        "customer.fax",
        "customer.website",
        "customer.currencyCode",
        "customer.updatedAt",
        "customerLocation.name as locationName",
        "address.addressLine1",
        "address.addressLine2",
        "address.city",
        "address.postalCode",
        "contact.firstName as contactFirstName",
        "contact.lastName as contactLastName",
        "contact.email as contactEmail",
        "contact.mobilePhone as contactMobilePhone",
        "contact.homePhone as contactHomePhone",
        "contact.workPhone as contactWorkPhone"
      ])
      .where("customer.id", "in", ids)
      .where("customer.companyId", "=", this.companyId)
      .execute();

    return this.groupAndTransformRows(rows as EntityRow[], true);
  }

  private groupAndTransformRows(
    rows: EntityRow[],
    isCustomer: boolean
  ): Map<string, Accounting.Contact> {
    const result = new Map<string, Accounting.Contact>();
    const groups = new Map<string, EntityRow[]>();

    for (const row of rows) {
      const existing = groups.get(row.id) ?? [];
      existing.push(row);
      groups.set(row.id, existing);
    }

    for (const [id, groupRows] of groups) {
      const addresses = groupRows
        .filter((r) => r.addressLine1 || r.city)
        .map((r) => ({
          label: r.locationName ?? null,
          type: null,
          line1: r.addressLine1 ?? null,
          line2: r.addressLine2 ?? null,
          city: r.city ?? null,
          country: null,
          region: null,
          postalCode: r.postalCode ?? null
        }));

      const row = groupRows[0]!;
      result.set(id, {
        id: row.id,
        name: row.name,
        firstName: row.contactFirstName ?? "",
        lastName: row.contactLastName ?? "",
        companyId: row.companyId,
        email: row.contactEmail ?? undefined,
        website: row.website ?? null,
        taxId: row.taxId ?? null,
        currencyCode: row.currencyCode ?? "USD",
        balance: null,
        creditLimit: null,
        paymentTerms: null,
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        workPhone: row.contactWorkPhone ?? row.phone ?? null,
        mobilePhone: row.contactMobilePhone ?? null,
        fax: row.fax ?? null,
        homePhone: row.contactHomePhone ?? null,
        isVendor: !isCustomer,
        isCustomer,
        addresses,
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // 3. REMOTE FETCH
  // =================================================================

  async fetchRemote(id: string): Promise<QBCustomer | null> {
    const result = await this.qb.request<{ Customer: QBCustomer }>(
      "GET",
      `/customer/${id}`
    );

    return result.error ? null : (result.data?.Customer ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, QBCustomer>> {
    const result = new Map<string, QBCustomer>();
    if (ids.length === 0) return result;

    const idList = ids.map((id) => `'${id}'`).join(",");
    const response = await this.qb.query<QBCustomer>(
      `SELECT * FROM Customer WHERE Id IN (${idList})`
    );

    if (response.error) {
      throwQBApiError("fetch customers batch", response);
    }

    const customers = (response.data as any)?.Customer ?? [];
    for (const customer of customers) {
      result.set(customer.Id, customer);
    }

    return result;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Contact
  ): Promise<Omit<QBCustomer, "SyncToken" | "Id">> {
    return {
      DisplayName: local.name,
      CompanyName: local.name,
      GivenName: local.firstName || undefined,
      FamilyName: local.lastName || undefined,
      PrimaryEmailAddr: local.email ? { Address: local.email } : undefined,
      PrimaryPhone: local.workPhone
        ? { FreeFormNumber: local.workPhone }
        : undefined,
      Mobile: local.mobilePhone
        ? { FreeFormNumber: local.mobilePhone }
        : undefined,
      Fax: local.fax ? { FreeFormNumber: local.fax } : undefined,
      WebAddr: local.website ? { URI: local.website } : undefined,
      BillAddr: local.addresses[0]
        ? {
            Line1: local.addresses[0].line1 ?? undefined,
            Line2: local.addresses[0].line2 ?? undefined,
            City: local.addresses[0].city ?? undefined,
            CountrySubDivisionCode: local.addresses[0].region ?? undefined,
            PostalCode: local.addresses[0].postalCode ?? undefined,
            Country: local.addresses[0].country ?? undefined
          }
        : undefined,
      CurrencyRef: { value: local.currencyCode },
      Active: true
    };
  }

  // =================================================================
  // 5. TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: QBCustomer
  ): Promise<Partial<Accounting.Contact>> {
    const addresses: Accounting.Contact["addresses"] = [];

    if (remote.BillAddr) {
      addresses.push({
        label: "Billing",
        type: "billing",
        line1: remote.BillAddr.Line1 ?? null,
        line2: remote.BillAddr.Line2 ?? null,
        city: remote.BillAddr.City ?? null,
        region: remote.BillAddr.CountrySubDivisionCode ?? null,
        country: remote.BillAddr.Country ?? null,
        postalCode: remote.BillAddr.PostalCode ?? null
      });
    }

    if (remote.ShipAddr) {
      addresses.push({
        label: "Shipping",
        type: "shipping",
        line1: remote.ShipAddr.Line1 ?? null,
        line2: remote.ShipAddr.Line2 ?? null,
        city: remote.ShipAddr.City ?? null,
        region: remote.ShipAddr.CountrySubDivisionCode ?? null,
        country: remote.ShipAddr.Country ?? null,
        postalCode: remote.ShipAddr.PostalCode ?? null
      });
    }

    return {
      name: remote.DisplayName,
      firstName: remote.GivenName ?? "",
      lastName: remote.FamilyName ?? "",
      email: remote.PrimaryEmailAddr?.Address ?? undefined,
      website: remote.WebAddr?.URI ?? null,
      taxId: null,
      currencyCode: remote.CurrencyRef?.value ?? "USD",
      isCustomer: true,
      isVendor: false,
      workPhone: remote.PrimaryPhone?.FreeFormNumber ?? null,
      mobilePhone: remote.Mobile?.FreeFormNumber ?? null,
      fax: remote.Fax?.FreeFormNumber ?? null,
      homePhone: null,
      addresses
    };
  }

  // =================================================================
  // 6. UPSERT LOCAL
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    remoteId: string
  ): Promise<string> {
    let existingLocalId = await this.getLocalId(remoteId);

    // Smart match by name
    if (!existingLocalId && data.name) {
      const match = await tx
        .selectFrom("customer")
        .select("id")
        .where("name", "=", data.name)
        .where("companyId", "=", this.companyId)
        .executeTakeFirst();
      existingLocalId = match?.id ?? null;
    }

    if (existingLocalId) {
      await tx
        .updateTable("customer")
        .set({
          name: data.name,
          taxId: data.taxId,
          website: data.website,
          phone: data.workPhone,
          fax: data.fax,
          currencyCode: data.currencyCode,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", existingLocalId)
        .execute();
      return existingLocalId;
    }

    const result = await tx
      .insertInto("customer")
      .values({
        companyId: this.companyId,
        name: data.name!,
        taxId: data.taxId,
        website: data.website,
        phone: data.workPhone,
        fax: data.fax,
        currencyCode: data.currencyCode,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return result.id;
  }

  // =================================================================
  // 7. UPSERT REMOTE
  // =================================================================

  protected async upsertRemote(
    data: Omit<QBCustomer, "SyncToken" | "Id">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      // QBO requires SyncToken for updates — fetch current entity first
      const current = await this.fetchRemote(existingRemoteId);
      if (!current) {
        throw new Error(
          `QuickBooks customer ${existingRemoteId} not found for update`
        );
      }

      const result = await this.qb.request<{ Customer: QBCustomer }>(
        "POST",
        "/customer",
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
        throwQBApiError("update customer", result);
      }

      return result.data!.Customer.Id;
    }

    // Create new
    const result = await this.qb.request<{ Customer: QBCustomer }>(
      "POST",
      "/customer",
      { body: JSON.stringify(data) }
    );

    if (result.error) {
      throwQBApiError("create customer", result);
    }

    if (!result.data?.Customer?.Id) {
      throw new Error(
        "QuickBooks API returned success but no Customer Id was returned"
      );
    }

    return result.data.Customer.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<QBCustomer, "SyncToken" | "Id">;
    }>
  ): Promise<Map<string, string>> {
    // QBO doesn't have a native batch API for customers,
    // so we process them sequentially
    const result = new Map<string, string>();

    for (const { localId, payload } of data) {
      const remoteId = await this.upsertRemote(payload, localId);
      result.set(localId, remoteId);
    }

    return result;
  }
}

// ============================================================================
// Vendor Syncer
// ============================================================================

export class VendorSyncer extends BaseEntitySyncer<
  Accounting.Contact,
  QBVendor,
  "SyncToken" | "Id"
> {
  private get qb(): QuickBooksProvider {
    return this.provider as QuickBooksProvider;
  }

  protected getRemoteUpdatedAt(remote: QBVendor): Date | null {
    return remote.MetaData?.LastUpdatedTime
      ? new Date(remote.MetaData.LastUpdatedTime)
      : null;
  }

  async fetchLocal(id: string): Promise<Accounting.Contact | null> {
    const results = await this.fetchSuppliersByIds([id]);
    return results.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();
    return this.fetchSuppliersByIds(ids);
  }

  private async fetchSuppliersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Contact>> {
    if (ids.length === 0) return new Map();

    const rows = await this.database
      .selectFrom("supplier")
      .leftJoin(
        "supplierLocation",
        "supplierLocation.supplierId",
        "supplier.id"
      )
      .leftJoin("address", "address.id", "supplierLocation.addressId")
      .leftJoin("supplierContact", "supplierContact.supplierId", "supplier.id")
      .leftJoin("contact", "contact.id", "supplierContact.contactId")
      .select([
        "supplier.id",
        "supplier.name",
        "supplier.companyId",
        "supplier.taxId",
        "supplier.phone",
        "supplier.fax",
        "supplier.website",
        "supplier.currencyCode",
        "supplier.updatedAt",
        "supplierLocation.name as locationName",
        "address.addressLine1",
        "address.addressLine2",
        "address.city",
        "address.postalCode",
        "contact.firstName as contactFirstName",
        "contact.lastName as contactLastName",
        "contact.email as contactEmail",
        "contact.mobilePhone as contactMobilePhone",
        "contact.homePhone as contactHomePhone",
        "contact.workPhone as contactWorkPhone"
      ])
      .where("supplier.id", "in", ids)
      .where("supplier.companyId", "=", this.companyId)
      .execute();

    const result = new Map<string, Accounting.Contact>();
    const groups = new Map<string, EntityRow[]>();

    for (const row of rows as EntityRow[]) {
      const existing = groups.get(row.id) ?? [];
      existing.push(row);
      groups.set(row.id, existing);
    }

    for (const [id, groupRows] of groups) {
      const addresses = groupRows
        .filter((r) => r.addressLine1 || r.city)
        .map((r) => ({
          label: r.locationName ?? null,
          type: null,
          line1: r.addressLine1 ?? null,
          line2: r.addressLine2 ?? null,
          city: r.city ?? null,
          country: null,
          region: null,
          postalCode: r.postalCode ?? null
        }));

      const row = groupRows[0]!;
      result.set(id, {
        id: row.id,
        name: row.name,
        firstName: row.contactFirstName ?? "",
        lastName: row.contactLastName ?? "",
        companyId: row.companyId,
        email: row.contactEmail ?? undefined,
        website: row.website ?? null,
        taxId: row.taxId ?? null,
        currencyCode: row.currencyCode ?? "USD",
        balance: null,
        creditLimit: null,
        paymentTerms: null,
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        workPhone: row.contactWorkPhone ?? row.phone ?? null,
        mobilePhone: row.contactMobilePhone ?? null,
        fax: row.fax ?? null,
        homePhone: row.contactHomePhone ?? null,
        isVendor: true,
        isCustomer: false,
        addresses,
        raw: row
      });
    }

    return result;
  }

  async fetchRemote(id: string): Promise<QBVendor | null> {
    const result = await this.qb.request<{ Vendor: QBVendor }>(
      "GET",
      `/vendor/${id}`
    );

    return result.error ? null : (result.data?.Vendor ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, QBVendor>> {
    const result = new Map<string, QBVendor>();
    if (ids.length === 0) return result;

    const idList = ids.map((id) => `'${id}'`).join(",");
    const response = await this.qb.query<QBVendor>(
      `SELECT * FROM Vendor WHERE Id IN (${idList})`
    );

    if (response.error) {
      throwQBApiError("fetch vendors batch", response);
    }

    const vendors = (response.data as any)?.Vendor ?? [];
    for (const vendor of vendors) {
      result.set(vendor.Id, vendor);
    }

    return result;
  }

  protected async mapToRemote(
    local: Accounting.Contact
  ): Promise<Omit<QBVendor, "SyncToken" | "Id">> {
    return {
      DisplayName: local.name,
      CompanyName: local.name,
      GivenName: local.firstName || undefined,
      FamilyName: local.lastName || undefined,
      PrimaryEmailAddr: local.email ? { Address: local.email } : undefined,
      PrimaryPhone: local.workPhone
        ? { FreeFormNumber: local.workPhone }
        : undefined,
      Mobile: local.mobilePhone
        ? { FreeFormNumber: local.mobilePhone }
        : undefined,
      Fax: local.fax ? { FreeFormNumber: local.fax } : undefined,
      WebAddr: local.website ? { URI: local.website } : undefined,
      BillAddr: local.addresses[0]
        ? {
            Line1: local.addresses[0].line1 ?? undefined,
            Line2: local.addresses[0].line2 ?? undefined,
            City: local.addresses[0].city ?? undefined,
            CountrySubDivisionCode: local.addresses[0].region ?? undefined,
            PostalCode: local.addresses[0].postalCode ?? undefined,
            Country: local.addresses[0].country ?? undefined
          }
        : undefined,
      TaxIdentifier: local.taxId ?? undefined,
      CurrencyRef: { value: local.currencyCode },
      Active: true
    };
  }

  protected async mapToLocal(
    remote: QBVendor
  ): Promise<Partial<Accounting.Contact>> {
    const addresses: Accounting.Contact["addresses"] = [];

    if (remote.BillAddr) {
      addresses.push({
        label: "Billing",
        type: "billing",
        line1: remote.BillAddr.Line1 ?? null,
        line2: remote.BillAddr.Line2 ?? null,
        city: remote.BillAddr.City ?? null,
        region: remote.BillAddr.CountrySubDivisionCode ?? null,
        country: remote.BillAddr.Country ?? null,
        postalCode: remote.BillAddr.PostalCode ?? null
      });
    }

    return {
      name: remote.DisplayName,
      firstName: remote.GivenName ?? "",
      lastName: remote.FamilyName ?? "",
      email: remote.PrimaryEmailAddr?.Address ?? undefined,
      website: remote.WebAddr?.URI ?? null,
      taxId: remote.TaxIdentifier ?? null,
      currencyCode: remote.CurrencyRef?.value ?? "USD",
      isCustomer: false,
      isVendor: true,
      workPhone: remote.PrimaryPhone?.FreeFormNumber ?? null,
      mobilePhone: remote.Mobile?.FreeFormNumber ?? null,
      fax: remote.Fax?.FreeFormNumber ?? null,
      homePhone: null,
      addresses
    };
  }

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Contact>,
    remoteId: string
  ): Promise<string> {
    let existingLocalId = await this.getLocalId(remoteId);

    if (!existingLocalId && data.name) {
      const match = await tx
        .selectFrom("supplier")
        .select("id")
        .where("name", "=", data.name)
        .where("companyId", "=", this.companyId)
        .executeTakeFirst();
      existingLocalId = match?.id ?? null;
    }

    if (existingLocalId) {
      await tx
        .updateTable("supplier")
        .set({
          name: data.name,
          taxId: data.taxId,
          website: data.website,
          phone: data.workPhone,
          fax: data.fax,
          currencyCode: data.currencyCode,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", existingLocalId)
        .execute();
      return existingLocalId;
    }

    const result = await tx
      .insertInto("supplier")
      .values({
        companyId: this.companyId,
        name: data.name!,
        taxId: data.taxId,
        website: data.website,
        phone: data.workPhone,
        fax: data.fax,
        currencyCode: data.currencyCode,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return result.id;
  }

  protected async upsertRemote(
    data: Omit<QBVendor, "SyncToken" | "Id">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      const current = await this.fetchRemote(existingRemoteId);
      if (!current) {
        throw new Error(
          `QuickBooks vendor ${existingRemoteId} not found for update`
        );
      }

      const result = await this.qb.request<{ Vendor: QBVendor }>(
        "POST",
        "/vendor",
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
        throwQBApiError("update vendor", result);
      }

      return result.data!.Vendor.Id;
    }

    const result = await this.qb.request<{ Vendor: QBVendor }>(
      "POST",
      "/vendor",
      { body: JSON.stringify(data) }
    );

    if (result.error) {
      throwQBApiError("create vendor", result);
    }

    if (!result.data?.Vendor?.Id) {
      throw new Error(
        "QuickBooks API returned success but no Vendor Id was returned"
      );
    }

    return result.data.Vendor.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<QBVendor, "SyncToken" | "Id">;
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
