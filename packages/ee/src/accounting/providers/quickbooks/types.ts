/**
 * QuickBooks Online API types.
 *
 * QBO returns entities inside a wrapper object, e.g.:
 *   { Customer: { Id: "1", SyncToken: "0", ... } }
 *
 * Query responses come in the form:
 *   { QueryResponse: { Customer: [...], startPosition: 1, maxResults: 100, totalCount: 200 } }
 */

// ============================================================================
// Shared / Utility Types
// ============================================================================

export interface QBRef {
  value: string;
  name?: string;
}

export interface QBAddr {
  Id?: string;
  Line1?: string;
  Line2?: string;
  Line3?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
}

export interface QBEmailAddr {
  Address?: string;
}

export interface QBPhoneNumber {
  FreeFormNumber?: string;
}

export interface QBMetaData {
  CreateTime: string;
  LastUpdatedTime: string;
}

/** Wrapper for single-entity responses */
export interface QBResponse<T> {
  [key: string]: T;
}

/** Wrapper for query responses */
export interface QBQueryResponse<T> {
  QueryResponse: {
    [key: string]: T[] | number | undefined;
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

/** Error response from QBO API */
export interface QBErrorResponse {
  Fault: {
    Error: Array<{
      Message: string;
      Detail: string;
      code: string;
      element?: string;
    }>;
    type: string;
  };
}

// ============================================================================
// Customer
// ============================================================================

export interface QBCustomer {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: QBEmailAddr;
  PrimaryPhone?: QBPhoneNumber;
  Mobile?: QBPhoneNumber;
  Fax?: QBPhoneNumber;
  WebAddr?: { URI?: string };
  BillAddr?: QBAddr;
  ShipAddr?: QBAddr;
  CurrencyRef?: QBRef;
  Active?: boolean;
  Balance?: number;
  BalanceWithJobs?: number;
  MetaData?: QBMetaData;
}

// ============================================================================
// Vendor
// ============================================================================

export interface QBVendor {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: QBEmailAddr;
  PrimaryPhone?: QBPhoneNumber;
  Mobile?: QBPhoneNumber;
  Fax?: QBPhoneNumber;
  WebAddr?: { URI?: string };
  BillAddr?: QBAddr;
  CurrencyRef?: QBRef;
  TaxIdentifier?: string;
  Active?: boolean;
  Balance?: number;
  MetaData?: QBMetaData;
}

// ============================================================================
// Item
// ============================================================================

export interface QBItem {
  Id: string;
  SyncToken: string;
  Name: string;
  Description?: string;
  PurchaseDesc?: string;
  Type: "Inventory" | "NonInventory" | "Service" | "Group" | "Category";
  Active?: boolean;
  UnitPrice?: number;
  PurchaseCost?: number;
  IncomeAccountRef?: QBRef;
  ExpenseAccountRef?: QBRef;
  AssetAccountRef?: QBRef;
  QtyOnHand?: number;
  Sku?: string;
  Taxable?: boolean;
  SalesTaxIncluded?: boolean;
  PurchaseTaxIncluded?: boolean;
  MetaData?: QBMetaData;
}

// ============================================================================
// Invoice (Sales Invoice)
// ============================================================================

export interface QBInvoiceLine {
  Id?: string;
  LineNum?: number;
  Description?: string;
  Amount: number;
  DetailType:
    | "SalesItemLineDetail"
    | "SubTotalLineDetail"
    | "DiscountLineDetail";
  SalesItemLineDetail?: {
    ItemRef?: QBRef;
    Qty?: number;
    UnitPrice?: number;
    TaxCodeRef?: QBRef;
  };
}

export interface QBInvoice {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  CustomerRef: QBRef;
  TxnDate?: string;
  DueDate?: string;
  Line: QBInvoiceLine[];
  CurrencyRef?: QBRef;
  ExchangeRate?: number;
  TotalAmt?: number;
  Balance?: number;
  TxnTaxDetail?: {
    TotalTax?: number;
    TaxLine?: Array<{
      Amount: number;
      DetailType: string;
      TaxLineDetail?: {
        TaxRateRef?: QBRef;
        PercentBased?: boolean;
        TaxPercent?: number;
        NetAmountTaxable?: number;
      };
    }>;
  };
  CustomerMemo?: { value: string };
  EmailStatus?: "NotSet" | "NeedToSend" | "EmailSent";
  MetaData?: QBMetaData;
}

// ============================================================================
// Bill (Purchase Invoice)
// ============================================================================

export interface QBBillLine {
  Id?: string;
  LineNum?: number;
  Description?: string;
  Amount: number;
  DetailType: "ItemBasedExpenseLineDetail" | "AccountBasedExpenseLineDetail";
  ItemBasedExpenseLineDetail?: {
    ItemRef?: QBRef;
    Qty?: number;
    UnitPrice?: number;
    TaxCodeRef?: QBRef;
    BillableStatus?: string;
  };
  AccountBasedExpenseLineDetail?: {
    AccountRef: QBRef;
    TaxCodeRef?: QBRef;
    BillableStatus?: string;
  };
}

export interface QBBill {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  VendorRef: QBRef;
  TxnDate?: string;
  DueDate?: string;
  Line: QBBillLine[];
  CurrencyRef?: QBRef;
  ExchangeRate?: number;
  TotalAmt?: number;
  Balance?: number;
  TxnTaxDetail?: {
    TotalTax?: number;
  };
  MetaData?: QBMetaData;
}

// ============================================================================
// Purchase Order
// ============================================================================

export interface QBPurchaseOrderLine {
  Id?: string;
  LineNum?: number;
  Description?: string;
  Amount: number;
  DetailType: "ItemBasedExpenseLineDetail";
  ItemBasedExpenseLineDetail?: {
    ItemRef?: QBRef;
    Qty?: number;
    UnitPrice?: number;
    TaxCodeRef?: QBRef;
  };
}

export interface QBPurchaseOrder {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  VendorRef: QBRef;
  TxnDate?: string;
  ShipAddr?: QBAddr;
  Line: QBPurchaseOrderLine[];
  CurrencyRef?: QBRef;
  ExchangeRate?: number;
  TotalAmt?: number;
  TxnTaxDetail?: {
    TotalTax?: number;
  };
  POStatus?: "Open" | "Closed";
  POEmail?: QBEmailAddr;
  MetaData?: QBMetaData;
}

// ============================================================================
// Payment
// ============================================================================

export interface QBPaymentLine {
  Amount: number;
  LinkedTxn: Array<{
    TxnId: string;
    TxnType: "Invoice" | "Bill" | "CreditMemo" | "JournalEntry";
  }>;
}

export interface QBPayment {
  Id: string;
  SyncToken: string;
  CustomerRef: QBRef;
  TotalAmt: number;
  TxnDate?: string;
  CurrencyRef?: QBRef;
  Line: QBPaymentLine[];
  PaymentMethodRef?: QBRef;
  DepositToAccountRef?: QBRef;
  MetaData?: QBMetaData;
}

// ============================================================================
// Account (Chart of Accounts)
// ============================================================================

export interface QBAccount {
  Id: string;
  SyncToken: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  Classification?: "Asset" | "Equity" | "Expense" | "Liability" | "Revenue";
  CurrentBalance?: number;
  Active?: boolean;
  FullyQualifiedName?: string;
  AcctNum?: string;
  CurrencyRef?: QBRef;
  MetaData?: QBMetaData;
}

// ============================================================================
// Company Info
// ============================================================================

export interface QBCompanyInfo {
  CompanyName: string;
  LegalName?: string;
  Country?: string;
  HomeCurrency?: QBRef;
  FiscalYearStartMonth?: string;
  MetaData?: QBMetaData;
}
