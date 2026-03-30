import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { buyRate, getRates } from "~/modules/inventory/easypost.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const shipmentId = formData.get("shipmentId") as string;

  if (!shipmentId) {
    return { error: { message: "Shipment ID is required" }, data: null };
  }

  switch (intent) {
    case "getRates": {
      try {
        const rates = await getRates(client, companyId, shipmentId);
        return { error: null, data: { rates } };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to get rates";
        return { error: { message }, data: null };
      }
    }
    case "buyRate": {
      const rateId = formData.get("rateId") as string;
      if (!rateId) {
        return { error: { message: "Rate ID is required" }, data: null };
      }
      try {
        const result = await buyRate(client, companyId, shipmentId, rateId);
        return { error: null, data: result };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to purchase label";
        return { error: { message }, data: null };
      }
    }
    default:
      return { error: { message: `Invalid intent: ${intent}` }, data: null };
  }
}
