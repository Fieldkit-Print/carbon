/**
 * Shipstation Custom Store endpoint (per company)
 *
 *   GET  /api/shipstation/orders/:companyId?action=export&start_date=...&end_date=...
 *        → XML of shipments in the window
 *
 *   POST /api/shipstation/orders/:companyId?action=shipnotify&order_number=...&...
 *        → Stamps tracking + fetches cost via Shipstation REST API
 *
 * Auth is HTTP Basic — credentials are stored per-company in
 * `companyIntegration.metadata.basicAuthUsername` /
 * `.basicAuthPassword` for the row with `id = 'shipstation'`.
 *
 * Multi-tenant via path param so Shipstation's single URL per store
 * can be wired up cleanly across multiple Carbon companies.
 *
 * @see {@link file://./../../modules/integrations/shipstation/}
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { verifyShipstationBasicAuth } from "~/modules/integrations/shipstation/auth.server";
import { getShipstationIntegration } from "~/modules/integrations/shipstation/client.server";
import {
  listShipmentsForExport,
  serializeOrdersXml
} from "~/modules/integrations/shipstation/export.server";
import {
  applyShipnotify,
  parseShipnotify
} from "~/modules/integrations/shipstation/shipnotify.server";

const BASIC_AUTH_REALM = 'Basic realm="Shipstation"';

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": BASIC_AUTH_REALM }
  });
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) return badRequest("Missing companyId");

  const client = await getCarbonServiceRole();
  let metadata;
  try {
    metadata = await getShipstationIntegration(client, companyId);
  } catch (cause) {
    return new Response((cause as Error).message, { status: 500 });
  }

  if (!verifyShipstationBasicAuth(request, metadata)) return unauthorized();

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action !== "export") return badRequest(`Unknown action: ${action}`);

  const start = parseDateParam(
    url.searchParams.get("start_date"),
    /* defaultDaysAgo */ 30
  );
  const end = parseDateParam(url.searchParams.get("end_date"), 0);

  try {
    const orders = await listShipmentsForExport({
      client,
      companyId,
      start,
      end
    });
    const xml = serializeOrdersXml(orders);
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" }
    });
  } catch (cause) {
    console.error("[Shipstation export] failed", cause);
    return new Response("Internal error", { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;
  if (!companyId) return badRequest("Missing companyId");

  const client = await getCarbonServiceRole();
  let metadata;
  try {
    metadata = await getShipstationIntegration(client, companyId);
  } catch (cause) {
    return new Response((cause as Error).message, { status: 500 });
  }

  if (!verifyShipstationBasicAuth(request, metadata)) return unauthorized();

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action !== "shipnotify") return badRequest(`Unknown action: ${action}`);

  try {
    const notify = await parseShipnotify(request);
    if (!notify.orderNumber) return badRequest("Missing order_number");
    const summary = await applyShipnotify({
      client,
      companyId,
      metadata,
      notify
    });
    return new Response(summary, { status: 200 });
  } catch (cause) {
    console.error("[Shipstation shipnotify] failed", cause);
    return new Response("Internal error", { status: 500 });
  }
}

/**
 * Parses Shipstation's `MM/dd/yyyy HH:mm` (PT) or an ISO 8601 string.
 * Falls back to "30 days ago / now" when missing so the endpoint never
 * explodes on a malformed poll.
 */
function parseDateParam(raw: string | null, defaultDaysAgo: number): Date {
  if (!raw) {
    const d = new Date();
    if (defaultDaysAgo > 0) d.setUTCDate(d.getUTCDate() - defaultDaysAgo);
    return d;
  }
  const isoTry = new Date(raw);
  if (!Number.isNaN(isoTry.getTime())) return isoTry;
  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/
  );
  if (match) {
    const [, mm, dd, yyyy, hh, mi] = match;
    const isoLike = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(
      2,
      "0"
    )}T${hh.padStart(2, "0")}:${mi}:00-08:00`;
    const parsed = new Date(isoLike);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - defaultDaysAgo);
  return d;
}
