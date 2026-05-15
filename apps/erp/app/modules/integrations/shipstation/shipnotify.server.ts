/**
 * Shipstation Custom Store — Shipnotify handler (Carbon side)
 *
 * Shipstation POSTs to our shipnotify URL every time a label is printed
 * for one of our orders. The payload itself doesn't include the
 * shipment cost, so this handler:
 *
 *   1. Parses the shipnotify (query + body) into `ShipstationShipnotify`
 *   2. Calls Shipstation's `GET /shipments?orderNumber=X` to fetch the
 *      full shipment record including `shipmentCost` + `insuranceCost`
 *   3. Stamps the matching Carbon `shipment` row with carrier, service,
 *      tracking, cost, and shipDate
 *
 * The follow-up API call is the price we pay for using Custom Store's
 * shipnotify instead of Shipstation's full webhook surface — Custom
 * Store keeps the integration to a single inbound URL but trades that
 * for a leaner payload that we have to enrich.
 *
 * Idempotent — re-running on the same order_number overwrites the
 * already-stamped columns with the same values.
 *
 * @see {@link file://./client.server.ts} Shipstation REST helper
 * @see {@link file://./types.ts}
 */

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchShipstationShipmentByOrderNumber,
  type ShipstationIntegrationMetadata
} from "./client.server";
import type { ShipstationShipnotify } from "./types";

type Client = SupabaseClient<Database>;

/**
 * Reads shipnotify fields off the request URL and body. Shipstation
 * has shipped variants over time — keep parsing tolerant.
 */
export async function parseShipnotify(
  request: Request
): Promise<ShipstationShipnotify> {
  const url = new URL(request.url);
  const qs = url.searchParams;

  let body: Record<string, unknown> = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData().catch(() => null);
    if (form) body = Object.fromEntries(form.entries());
  }

  const pick = (key: string): string | null => {
    const fromQs = qs.get(key);
    if (fromQs != null && fromQs !== "") return fromQs;
    const fromBody = body[key];
    if (typeof fromBody === "string" && fromBody !== "") return fromBody;
    return null;
  };

  const isReturnRaw =
    pick("is_return") ?? pick("isReturn") ?? pick("return_label") ?? "false";

  return {
    orderNumber: pick("order_number") ?? pick("orderNumber") ?? "",
    carrier: pick("carrier"),
    service: pick("service"),
    trackingNumber: pick("tracking_number") ?? pick("trackingNumber"),
    shipDate: pick("ship_date") ?? pick("shipDate"),
    isReturn: ["1", "true", "yes", "on"].includes(isReturnRaw.toLowerCase())
  };
}

/**
 * Resolves the shipnotify against Carbon's shipment table and stamps
 * tracking + cost.
 *
 * Returns a short summary string for the route's response body and
 * telemetry.
 */
export async function applyShipnotify(args: {
  client: Client;
  companyId: string;
  metadata: ShipstationIntegrationMetadata;
  notify: ShipstationShipnotify;
}): Promise<string> {
  const { client, companyId, metadata, notify } = args;
  if (!notify.orderNumber) {
    return "ignored: missing order_number";
  }

  // The Carbon `shipment.shipmentId` is the human-readable id ("SHP-...")
  // we emitted as `OrderNumber` in the export. Resolve to the row id.
  const { data: shipmentRow, error: lookupErr } = await client
    .from("shipment")
    .select("id, status")
    .eq("companyId", companyId)
    .eq("shipmentId", notify.orderNumber)
    .maybeSingle();

  if (lookupErr) {
    throw new Error(
      `Failed to look up shipment ${notify.orderNumber}: ${lookupErr.message}`
    );
  }
  if (!shipmentRow) {
    return `ignored: order_number ${notify.orderNumber} does not match any Carbon shipment`;
  }

  // Backfill the cost via Shipstation's REST API. The shipnotify carries
  // carrier/service/tracking but not shipmentCost — and we need cost for
  // Phase 3 expense reconciliation.
  const apiShipment = await fetchShipstationShipmentByOrderNumber({
    metadata,
    orderNumber: notify.orderNumber
  });

  const shippedAt = notify.shipDate
    ? new Date(notify.shipDate)
    : apiShipment?.shipDate
      ? new Date(apiShipment.shipDate)
      : new Date();

  const updateRow: Record<string, unknown> = {
    trackingNumber:
      notify.trackingNumber ?? apiShipment?.trackingNumber ?? null,
    shipstationCarrierCode: notify.carrier ?? apiShipment?.carrierCode ?? null,
    shipstationServiceCode: notify.service ?? apiShipment?.serviceCode ?? null,
    shipstationShippedAt: shippedAt.toISOString(),
    shipstationShipmentCost: apiShipment?.shipmentCost ?? null,
    shipstationInsuranceCost: apiShipment?.insuranceCost ?? null,
    updatedAt: new Date().toISOString()
  };

  if (apiShipment?.shipmentId != null) {
    updateRow.shipstationShipmentId = String(apiShipment.shipmentId);
  }

  const { error: updateErr } = await client
    .from("shipment")
    .update(updateRow as never)
    .eq("id", shipmentRow.id);

  if (updateErr) {
    throw new Error(
      `Failed to stamp shipment ${shipmentRow.id}: ${updateErr.message}`
    );
  }

  return `stamped shipment ${shipmentRow.id} (cost ${
    apiShipment?.shipmentCost ?? "unknown"
  }, tracking ${notify.trackingNumber ?? "—"})`;
}
