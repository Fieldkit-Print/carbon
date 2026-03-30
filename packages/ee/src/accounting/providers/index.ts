import type { QuickBooksProvider } from "./quickbooks/provider";
import type { XeroProvider } from "./xero";

export type AccountingProvider = XeroProvider | QuickBooksProvider;

export * from "./quickbooks";
export * from "./xero";
