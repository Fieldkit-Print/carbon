/**
 * Shipstation REST client (Carbon side)
 *
 * Loads the Shipstation API key/secret out of the per-company
 * `companyIntegration` row (id = 'shipstation') and wraps the v1 REST
 * endpoints we actually call from the shipnotify handler.
 *
 * Why we need this on top of the Custom Store inbound:
 *   Shipstation's shipnotify POST carries tracking and carrier but
 *   NOT shipment cost. Phase 3 needs cost to bill customers, so we
 *   make a follow-up `GET /shipments?orderNumber=X` call after every
 *   shipnotify to fetch the row including `shipmentCost` +
 *   `insuranceCost`, and stamp those onto Carbon's shipment row.
 *
 * @see {@link file://./shipnotify.server.ts}
 * @see https://www.shipstation.com/docs/api/shipments/list
 */

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ShipstationApiShipment } from "./types";

type Client = SupabaseClient<Database>;

/**
 * Shape stored in `companyIntegration.metadata` for the shipstation
 * integration row. `basicAuthUsername` / `basicAuthPassword` are the
 * credentials Shipstation will use against our Custom Store URL.
 * `apiKey` / `apiSecret` are the credentials we use to call
 * Shipstation back.
 */
export type ShipstationIntegrationMetadata = {
  apiKey: string;
  apiSecret: string;
  basicAuthUsername: string;
  basicAuthPassword: string;
};

/**
 * Loads + validates the per-company Shipstation integration row.
 * Throws when the row doesn't exist or any required field is missing,
 * so callers don't have to guard for partial config.
 */
export async function getShipstationIntegration(
  client: Client,
  companyId: string
): Promise<ShipstationIntegrationMetadata> {
  const { data } = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("companyId", companyId)
    .eq("id", "shipstation")
    .limit(1)
    .maybeSingle();

  const metadata = data?.metadata as
    | Partial<ShipstationIntegrationMetadata>
    | undefined;

  if (
    !metadata ||
    !metadata.apiKey ||
    !metadata.apiSecret ||
    !metadata.basicAuthUsername ||
    !metadata.basicAuthPassword
  ) {
    throw new Error(
      "Shipstation integration is not configured. Visit Settings → Integrations to add API key, API secret, and Custom Store basic-auth credentials."
    );
  }

  return metadata as ShipstationIntegrationMetadata;
}

/**
 * Looks up the Shipstation shipment(s) for a Carbon order_number and
 * returns the most recent one. Used by the shipnotify handler to
 * backfill cost data the Custom Store payload doesn't include.
 *
 * Returns null when Shipstation has no shipment for the order yet —
 * this happens if the operator hasn't actually bought a label and
 * the shipnotify was triggered some other way.
 */
export async function fetchShipstationShipmentByOrderNumber(args: {
  metadata: ShipstationIntegrationMetadata;
  orderNumber: string;
}): Promise<ShipstationApiShipment | null> {
  const { metadata, orderNumber } = args;
  const url = new URL("https://ssapi.shipstation.com/shipments");
  url.searchParams.set("orderNumber", orderNumber);
  url.searchParams.set("includeShipmentItems", "false");
  url.searchParams.set("pageSize", "5");

  const auth = Buffer.from(
    `${metadata.apiKey}:${metadata.apiSecret}`,
    "utf8"
  ).toString("base64");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shipstation API GET /shipments failed: ${res.status} ${res.statusText} ${body}`
    );
  }

  const body = (await res.json()) as {
    shipments?: Array<{
      shipmentId: number;
      orderNumber: string;
      carrierCode: string | null;
      serviceCode: string | null;
      trackingNumber: string | null;
      shipDate: string | null;
      shipmentCost: number | null;
      insuranceCost: number | null;
      voidDate?: string | null;
    }>;
  };

  // Pick the most recent non-voided shipment. Shipstation returns
  // them newest-first by default; we still belt-and-suspenders sort
  // on shipDate to be safe.
  const candidates = (body.shipments ?? [])
    .filter((s) => !s.voidDate)
    .sort((a, b) => (b.shipDate ?? "").localeCompare(a.shipDate ?? ""));

  const pick = candidates[0];
  if (!pick) return null;

  return {
    shipmentId: pick.shipmentId,
    orderNumber: pick.orderNumber,
    carrierCode: pick.carrierCode,
    serviceCode: pick.serviceCode,
    trackingNumber: pick.trackingNumber,
    shipDate: pick.shipDate,
    shipmentCost: pick.shipmentCost,
    insuranceCost: pick.insuranceCost
  };
}
