import { assertIsPost, ERP_URL, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { notifyEntityStatusChanged } from "@carbon/ee/notifications";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getSalesOrder,
  salesOrderStatusType,
  updateSalesOrderStatus
} from "~/modules/sales";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { orderId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof salesOrderStatusType)[number];

  if (!status || !salesOrderStatusType.includes(status)) {
    throw redirect(
      path.to.salesOrderDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const [update] = await Promise.all([
    updateSalesOrderStatus(client, {
      id,
      status,
      assignee: ["Closed"].includes(status) ? null : undefined,
      updatedBy: userId
    })
  ]);
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesOrderDetails(id),
      await flash(
        request,
        error(update.error, "Failed to update sales order status")
      )
    );
  }

  try {
    const [salesOrder, integrations] = await Promise.all([
      getSalesOrder(client, id),
      getCompanyIntegrations(client, companyId)
    ]);
    if (salesOrder.data) {
      const { data: customer } = await client
        .from("customer")
        .select("name")
        .eq("id", salesOrder.data.customerId ?? "")
        .maybeSingle();
      await notifyEntityStatusChanged({ client }, integrations, {
        companyId,
        userId,
        carbonUrl: `${ERP_URL}${path.to.salesOrderDetails(id)}`,
        entity: {
          entityType: "salesOrder",
          id,
          status,
          readableId: salesOrder.data.salesOrderId ?? "",
          customerName: customer?.name ?? ""
        }
      });
    }
  } catch (err) {
    console.error("Failed to notify sales order status change:", err);
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(request, success("Updated sales order status"))
  );
}
