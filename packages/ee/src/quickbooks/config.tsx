import { QUICKBOOKS_CLIENT_ID } from "@carbon/auth";
import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

const coerceBoolean = z.preprocess(
  (v) =>
    v === "true" || v === "on" ? true : v === "false" || v === "" ? false : v,
  z.boolean()
);

const SystemOfRecordSchema = z.enum(["carbon", "accounting"]);

const QuickBooksSettingsSchema = z.object({
  backfillCustomers: coerceBoolean.optional().default(true),
  backfillVendors: coerceBoolean.optional().default(true),
  backfillItems: coerceBoolean.optional().default(true),
  backfillInvoices: coerceBoolean.optional().default(true),
  backfillBills: coerceBoolean.optional().default(true),
  backfillPurchaseOrders: coerceBoolean.optional().default(true),
  // Per-entity system of record settings
  customerOwner: SystemOfRecordSchema.optional().default("accounting"),
  vendorOwner: SystemOfRecordSchema.optional().default("accounting"),
  itemOwner: SystemOfRecordSchema.optional().default("carbon"),
  invoiceOwner: SystemOfRecordSchema.optional().default("accounting"),
  billOwner: SystemOfRecordSchema.optional().default("accounting"),
  purchaseOrderOwner: SystemOfRecordSchema.optional().default("carbon"),
  // Default account codes for line items
  defaultSalesAccountCode: z.string().optional(),
  defaultPurchaseAccountCode: z.string().optional()
});

export const QuickBooks = defineIntegration({
  name: "QuickBooks",
  id: "quickbooks",
  active: true,
  category: "Accounting",
  logo: Logo,
  description:
    "Integrating Carbon with QuickBooks enables you to post transactions from sales invoices and purchase invoices into your existing accounting software, neatly organizing everything in your bookkeeping software.",
  shortDescription:
    "Automatically post transactions from sales and purchase invoices.",
  images: [],
  settingGroups: [
    {
      name: "Source of Truth",
      description: "Which system's data takes priority when there are conflicts"
    },
    {
      name: "Account Mapping",
      description: "Default accounts for syncing transactions to QuickBooks"
    }
  ],
  settings: [
    {
      name: "backfillCustomers",
      label: "Customers",
      description: "Include customers in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    },
    {
      name: "backfillVendors",
      label: "Vendors",
      description: "Include vendors/suppliers in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    },
    {
      name: "backfillItems",
      label: "Items",
      description: "Include items/products in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    },
    {
      name: "backfillInvoices",
      label: "Invoices",
      description: "Include sales invoices in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    },
    {
      name: "backfillBills",
      label: "Bills",
      description: "Include purchase invoices/bills in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    },
    {
      name: "backfillPurchaseOrders",
      label: "Purchase Orders",
      description: "Include purchase orders in sync",
      group: "Entities to Sync",
      type: "switch" as const,
      required: false,
      value: true
    },
    {
      name: "customerOwner",
      label: "Customers",
      group: "Source of Truth",
      type: "options" as const,
      listOptions: [
        {
          value: "accounting",
          label: "QuickBooks",
          description: "QuickBooks data overwrites Carbon data"
        },
        {
          value: "carbon",
          label: "Carbon",
          description: "Carbon data overwrites QuickBooks data"
        }
      ],
      required: false,
      value: "accounting"
    },
    {
      name: "vendorOwner",
      label: "Vendors",
      group: "Source of Truth",
      type: "options" as const,
      listOptions: [
        {
          value: "accounting",
          label: "QuickBooks",
          description: "QuickBooks data overwrites Carbon data"
        },
        {
          value: "carbon",
          label: "Carbon",
          description: "Carbon data overwrites QuickBooks data"
        }
      ],
      required: false,
      value: "accounting"
    },
    {
      name: "itemOwner",
      label: "Items",
      group: "Source of Truth",
      type: "options" as const,
      listOptions: [
        {
          value: "carbon",
          label: "Carbon",
          description: "Carbon data overwrites QuickBooks data"
        },
        {
          value: "accounting",
          label: "QuickBooks",
          description: "QuickBooks data overwrites Carbon data"
        }
      ],
      required: false,
      value: "carbon"
    },
    {
      name: "invoiceOwner",
      label: "Invoices",
      group: "Source of Truth",
      type: "options" as const,
      listOptions: [
        {
          value: "accounting",
          label: "QuickBooks",
          description: "QuickBooks data overwrites Carbon data"
        },
        {
          value: "carbon",
          label: "Carbon",
          description: "Carbon data overwrites QuickBooks data"
        }
      ],
      required: false,
      value: "accounting"
    },
    {
      name: "billOwner",
      label: "Bills",
      group: "Source of Truth",
      type: "options" as const,
      listOptions: [
        {
          value: "accounting",
          label: "QuickBooks",
          description: "QuickBooks data overwrites Carbon data"
        },
        {
          value: "carbon",
          label: "Carbon",
          description: "Carbon data overwrites QuickBooks data"
        }
      ],
      required: false,
      value: "accounting"
    },
    {
      name: "purchaseOrderOwner",
      label: "Purchase Orders",
      group: "Source of Truth",
      type: "options" as const,
      listOptions: [
        {
          value: "carbon",
          label: "Carbon",
          description: "Carbon data overwrites QuickBooks data"
        },
        {
          value: "accounting",
          label: "QuickBooks",
          description: "QuickBooks data overwrites Carbon data"
        }
      ],
      required: false,
      value: "carbon"
    },
    {
      name: "defaultSalesAccountCode",
      label: "Default Sales Account",
      description: "Account code to use for sales invoice line items",
      group: "Account Mapping",
      type: "options" as const,
      listOptions: [], // Populated dynamically from QuickBooks
      required: true,
      value: ""
    },
    {
      name: "defaultPurchaseAccountCode",
      label: "Default Purchase Account",
      description: "Account code to use for purchase order and bill line items",
      group: "Account Mapping",
      type: "options" as const,
      listOptions: [], // Populated dynamically from QuickBooks
      required: true,
      value: ""
    }
  ],
  schema: QuickBooksSettingsSchema,
  oauth: {
    authUrl: "https://appcenter.intuit.com/connect/oauth2",
    clientId: QUICKBOOKS_CLIENT_ID ?? "",
    redirectUri: "/api/integrations/quickbooks/oauth",
    scopes: ["com.intuit.quickbooks.accounting"],
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
  },
  actions: [
    {
      id: "sync-data",
      label: "Run Initial Sync",
      description: "Runs the initial backfill for the selected entities above",
      endpoint: "/api/integrations/quickbooks/backfill"
    }
  ]
});

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      width="41"
      height="40"
      viewBox="0 0 41 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20.5 40C31.5456 40 40.5 31.0456 40.5 20C40.5 8.95437 31.5456 0 20.5 0C9.45437 0 0.5 8.95437 0.5 20C0.5 31.0456 9.45437 40 20.5 40Z"
        fill="#F5F5F3"
      />
      <path
        d="M6.05585 20C6.05585 22.0628 6.8753 24.0411 8.33392 25.4998C9.79255 26.9584 11.7709 27.7778 13.8337 27.7778H14.9446V24.8888H13.8337C13.1884 24.8939 12.5484 24.7713 11.9507 24.5279C11.3531 24.2845 10.8095 23.9252 10.3513 23.4707C9.8932 23.0163 9.52957 22.4756 9.28142 21.8799C9.03328 21.2841 8.90552 20.6452 8.90552 19.9999C8.90552 19.3545 9.03328 18.7156 9.28142 18.1199C9.52957 17.5242 9.8932 16.9835 10.3513 16.529C10.8095 16.0745 11.3531 15.7152 11.9507 15.4718C12.5484 15.2284 13.1884 15.1058 13.8337 15.111H16.5002V30.2222C16.5005 30.9883 16.8049 31.723 17.3466 32.2647C17.8883 32.8064 18.6229 33.1109 19.389 33.1113V12.2222H13.8337C12.8122 12.2222 11.8008 12.4233 10.8571 12.8142C9.91345 13.205 9.05599 13.7779 8.33372 14.5002C7.61145 15.2224 7.03851 16.0798 6.64762 17.0235C6.25673 17.9672 6.05585 18.9786 6.05585 20ZM27.1668 12.2222H26.0559V15.1113H27.1668C28.4538 15.1258 29.6831 15.6473 30.5881 16.5625C31.493 17.4778 32.0006 18.7129 32.0006 20C32.0006 21.2871 31.493 22.5223 30.5881 23.4375C29.6831 24.3527 28.4538 24.8742 27.1668 24.8888H24.5002V9.77815C24.5003 9.39876 24.4256 9.02309 24.2804 8.67257C24.1353 8.32206 23.9225 8.00357 23.6542 7.73529C23.386 7.46701 23.0675 7.2542 22.717 7.10901C22.3665 6.96381 21.9909 6.88908 21.6115 6.88908V27.7781H27.1668C29.2296 27.7781 31.2079 26.9587 32.6665 25.5001C34.1252 24.0415 34.9446 22.0631 34.9446 20.0003C34.9446 17.9375 34.1252 15.9592 32.6665 14.5006C31.2079 13.042 29.2296 12.2222 27.1668 12.2222Z"
        fill="#121212"
      />
    </svg>
  );
}
