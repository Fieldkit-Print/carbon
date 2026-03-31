import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getIntegration } from "~/modules/settings/settings.service";

const integrationValidator = z.object({
  apiKey: z.string(),
  webhookSecret: z.string().optional()
});

const trackingEventSchema = z.object({
  description: z.string(),
  result: z.object({
    id: z.string(),
    status: z.string(),
    tracking_code: z.string(),
    est_delivery_date: z.string().nullable(),
    tracking_details: z.array(
      z.object({
        message: z.string().optional(),
        status: z.string(),
        datetime: z.string(),
        tracking_location: z
          .object({
            city: z.string().nullable(),
            state: z.string().nullable(),
            country: z.string().nullable(),
            zip: z.string().nullable()
          })
          .optional()
      })
    )
  })
});

export async function loader({ params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return { success: true };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  const serviceRole = await getCarbonServiceRole();
  const easypostIntegration = await getIntegration(
    serviceRole,
    "easypost",
    companyId
  );

  if (easypostIntegration.error || !easypostIntegration.data) {
    return data({ success: false }, { status: 400 });
  }

  try {
    const { webhookSecret } = integrationValidator.parse(
      easypostIntegration.data.metadata
    );

    // EasyPost webhook signature verification
    const webhookSignature = request.headers.get("x-hmac-signature");
    if (webhookSecret && webhookSignature) {
      const crypto = await import("crypto");
      const body = await request.text();
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

      if (webhookSignature !== expectedSignature) {
        console.error("EasyPost webhook signature mismatch");
        return data({ success: false }, { status: 401 });
      }

      // Re-parse body since we consumed it
      const payload = JSON.parse(body);
      return handleWebhookEvent(serviceRole, companyId, payload);
    }

    // If no secret configured, still process but log warning
    const payload = await request.json();
    return handleWebhookEvent(serviceRole, companyId, payload);
  } catch (error) {
    console.error("EasyPost webhook error:", error);
    return data({ success: false }, { status: 500 });
  }
}

async function handleWebhookEvent(
  client: Awaited<ReturnType<typeof getCarbonServiceRole>>,
  companyId: string,
  payload: unknown
) {
  const parsed = trackingEventSchema.safeParse(payload);
  if (!parsed.success) {
    // Not a tracking event we handle
    return data({ success: true });
  }

  const { result } = parsed.data;

  if (parsed.data.description === "tracker.updated") {
    // First try to find a matching parcel by tracking number or EasyPost shipment ID
    const { data: parcel } = await client
      .from("parcel")
      .select("id, shipmentId")
      .eq("companyId", companyId)
      .or(
        `trackingNumber.eq.${result.tracking_code},easypostShipmentId.eq.${result.id}`
      )
      .maybeSingle();

    if (parcel) {
      // Update parcel-level tracking
      await client
        .from("parcel")
        .update({
          trackingStatus: result.status,
          estimatedDeliveryDate: result.est_delivery_date,
          trackingUpdatedAt: new Date().toISOString()
        })
        .eq("id", parcel.id);

      // Aggregate status to shipment: check if all parcels are delivered
      const { data: allParcels } = await client
        .from("parcel")
        .select("trackingStatus")
        .eq("shipmentId", parcel.shipmentId);

      if (allParcels) {
        const allDelivered = allParcels.every(
          (p) => p.trackingStatus === "delivered"
        );
        const aggregateStatus = allDelivered ? "delivered" : result.status;

        await client
          .from("shipment")
          .update({
            trackingStatus: aggregateStatus,
            estimatedDeliveryDate: result.est_delivery_date,
            trackingUpdatedAt: new Date().toISOString()
          })
          .eq("id", parcel.shipmentId);
      }

      return data({ success: true });
    }

    // Fall back to shipment-level lookup for backward compatibility
    const { data: shipment } = await client
      .from("shipment")
      .select("id")
      .eq("companyId", companyId)
      .or(
        `easypostTrackerId.eq.${result.id},trackingNumber.eq.${result.tracking_code}`
      )
      .maybeSingle();

    if (shipment) {
      await client
        .from("shipment")
        .update({
          trackingStatus: result.status,
          estimatedDeliveryDate: result.est_delivery_date,
          trackingUpdatedAt: new Date().toISOString()
        })
        .eq("id", shipment.id);
    }
  }

  return data({ success: true });
}
