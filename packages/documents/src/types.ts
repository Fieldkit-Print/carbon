import type { Database } from "@carbon/database";

export interface Email {
  company: Company;
  recipient: {
    firstName?: string;
    lastName?: string;
    email: string;
  };
  sender: {
    firstName: string;
    lastName: string;
    email: string;
  };
  locale: string;
}

export interface PDF {
  title?: string;
  meta?: Meta;
  company: Company;
  locale: string;
  /** Pre-resolved logo data URI for SVG compatibility in react-pdf */
  logoDataUri?: string | null;
}

export type Meta = {
  author?: string;
  keywords?: string;
  subject?: string;
};

export type Company = Database["public"]["Views"]["companies"]["Row"];
export type CompanySettings =
  Database["public"]["Tables"]["companySettings"]["Row"];
export type QuoteCustomerDetails =
  Database["public"]["Views"]["quoteCustomerDetails"]["Row"];
export type AccountsPayableBillingAddress =
  Database["public"]["Tables"]["companyAccountsPayableBillingAddress"]["Row"];
export type AccountsReceivableBillingAddress =
  Database["public"]["Tables"]["companyAccountsReceivableBillingAddress"]["Row"];
