import { QBBillSyncer } from "../providers/quickbooks/entities/bill";
import {
  CustomerSyncer as QBCustomerSyncer,
  VendorSyncer as QBVendorSyncer
} from "../providers/quickbooks/entities/contact";
import { QBSalesInvoiceSyncer } from "../providers/quickbooks/entities/invoice";
import { QBItemSyncer } from "../providers/quickbooks/entities/item";
import { QBPurchaseOrderSyncer } from "../providers/quickbooks/entities/purchase-order";
import { BillSyncer } from "../providers/xero/entities/bill";
import { ContactSyncer } from "../providers/xero/entities/contact";
import { InventoryAdjustmentSyncer } from "../providers/xero/entities/inventory-adjustment";
import { SalesInvoiceSyncer } from "../providers/xero/entities/invoice";
import { ItemSyncer } from "../providers/xero/entities/item";
import { PurchaseOrderSyncer } from "../providers/xero/entities/purchase-order";
import { SalesOrderSyncer } from "../providers/xero/entities/sales-order";
import { ProviderID } from "./models";
import type { IEntitySyncer, SyncContext } from "./types";

export const SyncFactory = {
  /**
   * Instantiates the correct Syncer class based on the Entity Type and Provider from context.
   * @param context - The execution context (DB connection, Provider, Config, entityType)
   */
  getSyncer(context: SyncContext): IEntitySyncer {
    const providerId = context.provider.id;

    if (providerId === ProviderID.QUICKBOOKS) {
      return this.getQuickBooksSyncer(context);
    }

    return this.getXeroSyncer(context);
  },

  getQuickBooksSyncer(context: SyncContext): IEntitySyncer {
    switch (context.entityType) {
      case "customer":
        return new QBCustomerSyncer(context);
      case "vendor":
        return new QBVendorSyncer(context);
      case "item":
        return new QBItemSyncer(context);
      case "invoice":
        return new QBSalesInvoiceSyncer(context);
      case "bill":
        return new QBBillSyncer(context);
      case "purchaseOrder":
        return new QBPurchaseOrderSyncer(context);
      default:
        throw new Error(
          `No QuickBooks Syncer implementation found for entity type: ${context.entityType}`
        );
    }
  },

  getXeroSyncer(context: SyncContext): IEntitySyncer {
    switch (context.entityType) {
      // Master Data
      case "vendor":
      case "customer":
        return new ContactSyncer(context);
      case "item":
        return new ItemSyncer(context);

      // Transaction Data
      case "bill":
        return new BillSyncer(context);
      case "invoice":
        return new SalesInvoiceSyncer(context);
      case "purchaseOrder":
        return new PurchaseOrderSyncer(context);

      case "inventoryAdjustment":
        return new InventoryAdjustmentSyncer(context);

      case "salesOrder":
        return new SalesOrderSyncer(context);

      // Not yet implemented
      // case "employee":
      //   Xero no longer supports the Employees API
      // case "payment":
      //   return new PaymentSyncer(context);

      default:
        throw new Error(
          `No Xero Syncer implementation found for entity type: ${context.entityType}`
        );
    }
  }
};
