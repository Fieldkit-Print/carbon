import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { ReceiptSourceDocument } from "~/modules/inventory";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Receipts",
  to: path.to.receipts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const url = new URL(request.url);
  const sourceDocument =
    (url.searchParams.get("sourceDocument") as ReceiptSourceDocument) ??
    undefined;
  const sourceDocumentId = url.searchParams.get("sourceDocumentId") ?? "";

  const defaults = await getUserDefaults(client, userId, companyId);
  const serviceRole = getCarbonServiceRole();

  switch (sourceDocument) {
    case "Sales Order":
      const salesOrderReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptFromSalesOrder",
          companyId,
          locationId: defaults.data?.locationId,
          salesOrderId: sourceDocumentId,
          receiptId: undefined,
          userId: userId
        },
        region: FunctionRegion.UsWest2
      });
      if (!salesOrderReceipt.data || salesOrderReceipt.error) {
        throw redirect(
          path.to.salesOrder(sourceDocumentId),
          await flash(
            request,
            error(salesOrderReceipt.error, "Failed to create return receipt")
          )
        );
      }

      throw redirect(path.to.receiptDetails(salesOrderReceipt.data.id));
    case "Purchase Order":
      const purchaseOrderReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptFromPurchaseOrder",
          companyId,
          locationId: defaults.data?.locationId,
          purchaseOrderId: sourceDocumentId,
          receiptId: undefined,
          userId: userId
        },
        region: FunctionRegion.UsWest2
      });
      if (!purchaseOrderReceipt.data || purchaseOrderReceipt.error) {
        throw redirect(
          path.to.purchaseOrder(sourceDocumentId),
          await flash(
            request,
            error(purchaseOrderReceipt.error, "Failed to create receipt")
          )
        );
      }

      throw redirect(path.to.receiptDetails(purchaseOrderReceipt.data.id));
    case "Inbound Transfer":
      const warehouseTransferReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptFromInboundTransfer",
          companyId,
          warehouseTransferId: sourceDocumentId,
          receiptId: undefined,
          userId: userId
        },
        region: FunctionRegion.UsWest2
      });
      if (!warehouseTransferReceipt.data || warehouseTransferReceipt.error) {
        throw redirect(
          path.to.warehouseTransfer(sourceDocumentId),
          await flash(
            request,
            error(warehouseTransferReceipt.error, "Failed to create receipt")
          )
        );
      }

      throw redirect(path.to.receiptDetails(warehouseTransferReceipt.data.id));
    default:
      const defaultReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "receiptDefault",
          companyId,
          locationId: defaults.data?.locationId,
          userId: userId
        },
        region: FunctionRegion.UsWest2
      });

      if (!defaultReceipt.data || defaultReceipt.error) {
        throw redirect(
          path.to.receipts,
          await flash(request, error(error, "Failed to create receipt"))
        );
      }

      throw redirect(path.to.receiptDetails(defaultReceipt.data.id));
  }
}
