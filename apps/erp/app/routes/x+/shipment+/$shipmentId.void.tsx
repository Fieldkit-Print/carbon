import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  try {
    const serviceRole = getCarbonServiceRole();

    // Verify shipment is posted before allowing void
    const { data: shipment } = await client
      .from("shipment")
      .select("status")
      .eq("id", shipmentId)
      .single();

    if (shipment?.status !== "Posted") {
      throw redirect(
        path.to.shipmentDetails(shipmentId),
        await flash(
          request,
          error(
            new Error("Can only void posted shipments"),
            "Invalid operation"
          )
        )
      );
    }

    const voidShipment = await serviceRole.functions.invoke("post-shipment", {
      body: {
        type: "void",
        shipmentId: shipmentId,
        userId: userId,
        companyId: companyId
      },
      region: FunctionRegion.UsWest2
    });

    if (voidShipment.error) {
      throw redirect(
        path.to.shipmentDetails(shipmentId),
        await flash(
          request,
          error(voidShipment.error, "Failed to void shipment")
        )
      );
    }

    return redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(request, success("Shipment voided"))
    );
  } catch (err) {
    throw redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(request, error(err, "Failed to void shipment"))
    );
  }
}
