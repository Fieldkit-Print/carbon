import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import {
  deleteParcel,
  upsertParcel
} from "~/modules/inventory/easypost.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "upsert": {
      const id = formData.get("id") as string | null;
      const shipmentId = formData.get("shipmentId") as string;
      const length = Number(formData.get("length") ?? 0);
      const width = Number(formData.get("width") ?? 0);
      const height = Number(formData.get("height") ?? 0);
      const weight = Number(formData.get("weight") ?? 0);
      const predefinedPackage =
        (formData.get("predefinedPackage") as string) || null;

      if (!shipmentId) {
        return { error: { message: "Shipment ID is required" }, data: null };
      }

      if (id) {
        return upsertParcel(client, {
          id,
          shipmentId,
          length,
          width,
          height,
          weight,
          predefinedPackage,
          updatedBy: userId
        });
      }

      return upsertParcel(client, {
        shipmentId,
        length,
        width,
        height,
        weight,
        predefinedPackage,
        companyId,
        createdBy: userId
      });
    }
    case "delete": {
      const parcelId = formData.get("parcelId") as string;
      if (!parcelId) {
        return { error: { message: "Parcel ID is required" }, data: null };
      }
      return deleteParcel(client, parcelId);
    }
    default:
      return { error: { message: `Invalid intent: ${intent}` }, data: null };
  }
}
