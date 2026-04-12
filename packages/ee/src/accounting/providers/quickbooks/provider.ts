import { ProviderID } from "../../core/models";
import type {
  AccountingEntityType,
  AuthProvider,
  BaseProvider,
  GlobalSyncConfig,
  ProviderConfig,
  ProviderCredentials
} from "../../core/types";
import {
  AccountingApiError,
  createOAuthClient,
  HTTPClient
} from "../../core/utils";
import type {
  QBAccount,
  QBBill,
  QBCompanyInfo,
  QBCustomer,
  QBInvoice,
  QBItem,
  QBPurchaseOrder,
  QBQueryResponse,
  QBVendor
} from "./types";

export interface QuickBooksSettings {
  defaultSalesAccountCode?: string;
  defaultPurchaseAccountCode?: string;
}

type QuickBooksProviderConfig = ProviderConfig<{
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  tenantId?: string; // QBO realmId
  environment?: "production" | "sandbox";
  settings?: QuickBooksSettings;
}> & {
  id: ProviderID.QUICKBOOKS;
  accessToken?: string;
  refreshToken?: string;
};

const QBO_BASE_URLS = {
  production: "https://quickbooks.api.intuit.com",
  sandbox: "https://sandbox-quickbooks.api.intuit.com"
} as const;

export class QuickBooksProvider implements BaseProvider {
  static id = ProviderID.QUICKBOOKS;

  http: HTTPClient;
  auth: AuthProvider;

  private readonly syncConfig!: GlobalSyncConfig;
  private readonly _settings: QuickBooksSettings;
  private readonly baseUrl: string;
  private readonly realmId: string | undefined;

  constructor(public config: Omit<QuickBooksProviderConfig, "id">) {
    this.syncConfig = config.syncConfig;
    this._settings = config.settings ?? {};
    this.realmId = config.tenantId;

    const env = config.environment ?? "sandbox";
    this.baseUrl = QBO_BASE_URLS[env];
    this.http = new HTTPClient(this.baseUrl);

    this.auth = createOAuthClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      redirectUri: config.redirectUri,
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      onTokenRefresh: config.onTokenRefresh,
      getAuthUrl(scopes: string[], redirectURL: string): string {
        const params = new URLSearchParams({
          response_type: "code",
          client_id: config.clientId,
          redirect_uri: redirectURL,
          scope: scopes.join(" "),
          state: crypto.randomUUID()
        });

        return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
      }
    });
  }

  get id(): ProviderID.QUICKBOOKS {
    // @ts-expect-error
    return this.constructor.id;
  }

  get settings(): QuickBooksSettings {
    return this._settings;
  }

  getSyncConfig(entity: AccountingEntityType) {
    return this.syncConfig.entities[entity];
  }

  authenticate(
    code: string,
    redirectUri: string
  ): Promise<ProviderCredentials> {
    return this.auth.exchangeCode(code, redirectUri);
  }

  /**
   * Make an authenticated request to the QBO API.
   * Automatically prepends /v3/company/{realmId} to the path.
   * Handles 401 by refreshing the token and retrying.
   */
  async request<T>(method: string, path: string, options?: RequestInit) {
    const { accessToken, ...creds } = this.auth.getCredentials();
    const realmId = creds.tenantId || this.realmId;

    if (!realmId) {
      throw new Error("QuickBooks realmId (tenantId) is required");
    }

    const fullPath = `/v3/company/${realmId}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...((options?.headers ?? {}) as Record<string, string>)
    };

    const response = await this.http.request<T>(method, fullPath, {
      ...options,
      headers
    });

    if (response.code === 401) {
      await this.auth.refresh();

      const c = this.auth.getCredentials();

      return this.http.request<T>(method, fullPath, {
        ...options,
        headers: {
          ...headers,
          Authorization: `Bearer ${c.accessToken}`
        }
      });
    }

    return response;
  }

  /**
   * Execute a QBO query (e.g., SELECT * FROM Customer WHERE Id IN ('1','2'))
   */
  async query<T>(queryString: string) {
    const encoded = encodeURIComponent(queryString);
    return this.request<QBQueryResponse<T>["QueryResponse"]>(
      "GET",
      `/query?query=${encoded}`
    );
  }

  async validate(): Promise<boolean> {
    try {
      const response = await this.request(
        "GET",
        "/companyinfo/" + this.realmId
      );
      return !response.error;
    } catch (error) {
      console.error("QuickBooks validate error:", error);
      return false;
    }
  }

  async getCompanyInfo(): Promise<QBCompanyInfo | null> {
    const response = await this.request<{ CompanyInfo: QBCompanyInfo }>(
      "GET",
      `/companyinfo/${this.realmId}`
    );

    if (response.error || !response.data?.CompanyInfo) {
      return null;
    }

    return response.data.CompanyInfo;
  }

  async listCustomers(
    page = 1,
    pageSize = 100
  ): Promise<{ customers: QBCustomer[]; hasMore: boolean }> {
    const startPosition = (page - 1) * pageSize + 1;
    const result = await this.query<QBCustomer>(
      `SELECT * FROM Customer STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
    );

    if (result.error || !result.data) {
      return { customers: [], hasMore: false };
    }

    const customers = (result.data as any).Customer ?? [];
    return { customers, hasMore: customers.length === pageSize };
  }

  async listVendors(
    page = 1,
    pageSize = 100
  ): Promise<{ vendors: QBVendor[]; hasMore: boolean }> {
    const startPosition = (page - 1) * pageSize + 1;
    const result = await this.query<QBVendor>(
      `SELECT * FROM Vendor STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
    );

    if (result.error || !result.data) {
      return { vendors: [], hasMore: false };
    }

    const vendors = (result.data as any).Vendor ?? [];
    return { vendors, hasMore: vendors.length === pageSize };
  }

  async listItems(
    page = 1,
    pageSize = 100
  ): Promise<{ items: QBItem[]; hasMore: boolean }> {
    const startPosition = (page - 1) * pageSize + 1;
    const result = await this.query<QBItem>(
      `SELECT * FROM Item STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
    );

    if (result.error || !result.data) {
      return { items: [], hasMore: false };
    }

    const items = (result.data as any).Item ?? [];
    return { items, hasMore: items.length === pageSize };
  }

  async listInvoices(
    page = 1,
    pageSize = 100
  ): Promise<{ invoices: QBInvoice[]; hasMore: boolean }> {
    const startPosition = (page - 1) * pageSize + 1;
    const result = await this.query<QBInvoice>(
      `SELECT * FROM Invoice STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
    );

    if (result.error || !result.data) {
      return { invoices: [], hasMore: false };
    }

    const invoices = (result.data as any).Invoice ?? [];
    return { invoices, hasMore: invoices.length === pageSize };
  }

  async listBills(
    page = 1,
    pageSize = 100
  ): Promise<{ bills: QBBill[]; hasMore: boolean }> {
    const startPosition = (page - 1) * pageSize + 1;
    const result = await this.query<QBBill>(
      `SELECT * FROM Bill STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
    );

    if (result.error || !result.data) {
      return { bills: [], hasMore: false };
    }

    const bills = (result.data as any).Bill ?? [];
    return { bills, hasMore: bills.length === pageSize };
  }

  async listPurchaseOrders(
    page = 1,
    pageSize = 100
  ): Promise<{ purchaseOrders: QBPurchaseOrder[]; hasMore: boolean }> {
    const startPosition = (page - 1) * pageSize + 1;
    const result = await this.query<QBPurchaseOrder>(
      `SELECT * FROM PurchaseOrder STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
    );

    if (result.error || !result.data) {
      return { purchaseOrders: [], hasMore: false };
    }

    const purchaseOrders = (result.data as any).PurchaseOrder ?? [];
    return { purchaseOrders, hasMore: purchaseOrders.length === pageSize };
  }

  async listAccounts(): Promise<QBAccount[]> {
    const result = await this.query<QBAccount>(
      "SELECT * FROM Account WHERE Active = true MAXRESULTS 1000"
    );

    if (result.error || !result.data) {
      return [];
    }

    return (result.data as any).Account ?? [];
  }
}

// ============================================================================
// QBO Error Parsing
// ============================================================================

/**
 * Creates and throws an AccountingApiError from a QBO API response.
 */
export function throwQBApiError(
  operation: string,
  response: { error: boolean; message: string; code: number; data: unknown }
): never {
  const details = extractQBErrorDetails(
    response.code,
    response.message,
    response.data
  );

  const error = new AccountingApiError("quickbooks", operation, details);

  console.error(`[QuickBooks API Error] ${operation}`, {
    statusCode: details.statusCode,
    statusText: details.statusText,
    providerErrorType: details.providerErrorType,
    providerMessage: details.providerMessage,
    validationErrors: details.validationErrors
  });

  throw error;
}

function extractQBErrorDetails(
  statusCode: number,
  statusText: string,
  responseData: unknown
) {
  const details: {
    statusCode: number;
    statusText: string;
    providerErrorType?: string;
    providerErrorCode?: string | number;
    providerMessage?: string;
    validationErrors?: Array<{ field?: string; message: string }>;
    rawResponse?: unknown;
  } = {
    statusCode,
    statusText,
    rawResponse: responseData
  };

  let data: unknown = responseData;
  if (typeof responseData === "string") {
    try {
      data = JSON.parse(responseData);
    } catch {
      if (responseData.length < 500) {
        details.providerMessage = responseData;
      }
      return details;
    }
  }

  if (typeof data !== "object" || data === null) {
    return details;
  }

  const obj = data as Record<string, any>;

  // QBO returns errors in a Fault object
  if (obj.Fault) {
    details.providerErrorType = obj.Fault.type;
    const errors = obj.Fault.Error;
    if (Array.isArray(errors) && errors.length > 0) {
      details.providerMessage = errors[0].Message;
      details.providerErrorCode = errors[0].code;
      details.validationErrors = errors.map(
        (e: { Message: string; Detail?: string; element?: string }) => ({
          field: e.element,
          message: e.Detail || e.Message
        })
      );
    }
  }

  return details;
}
