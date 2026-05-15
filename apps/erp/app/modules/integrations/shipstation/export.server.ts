/**
 * Shipstation Custom Store — Order export (Carbon side)
 *
 * Shipstation polls `GET /api/shipstation/orders/<companyId>?action=export`
 * with a date window and we respond with one XML document containing
 * every Pending or Voided shipment whose updatedAt falls in the window.
 *
 * Status mapping:
 *   - Pending → awaiting_shipment   (Shipstation should buy the label)
 *   - Voided  → cancelled           (Shipstation should drop the order)
 *   - Draft / Posted → not exported
 *
 * @see {@link file://./types.ts}
 * @see {@link file://./../../../routes/api+/shipstation.orders.$companyId.ts}
 */

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ShipstationAddress,
  ShipstationItem,
  ShipstationOrder
} from "./types";

type Client = SupabaseClient<Database>;

/**
 * Returns every Carbon shipment Shipstation should see, projected to
 * the shape we render to XML.
 */
export async function listShipmentsForExport(args: {
  client: Client;
  companyId: string;
  start: Date;
  end: Date;
}): Promise<ShipstationOrder[]> {
  const { client, companyId, start, end } = args;

  // Header + ship-from location + customer name.
  const { data: shipments, error } = await client
    .from("shipment")
    .select(
      `
      id,
      shipmentId,
      status,
      customerId,
      sourceDocument,
      sourceDocumentReadableId,
      internalNotes,
      externalNotes,
      createdAt,
      updatedAt,
      customer:customerId(name),
      shippingMethod:shippingMethodId(name)
    `
    )
    .eq("companyId", companyId)
    .in("status", ["Pending", "Voided"])
    .gte("updatedAt", start.toISOString())
    .lte("updatedAt", end.toISOString())
    .order("updatedAt", { ascending: true })
    .limit(500);

  if (error) {
    throw new Error(`Failed to list shipments for export: ${error.message}`);
  }
  if (!shipments?.length) return [];

  const shipmentIds = shipments.map((s) => s.id);
  const customerIds = Array.from(
    new Set(
      shipments.map((s) => s.customerId).filter((id): id is string => !!id)
    )
  );

  // Lines + items, customer locations (joined to address), parcels — all
  // in parallel. The customer→address path goes through `customerLocation`
  // since address has no direct customer FK.
  const [linesRes, locationsRes, parcelsRes] = await Promise.all([
    client
      .from("shipmentLine")
      .select(
        `
        shipmentId, itemId, shippedQuantity, unitOfMeasure, unitPrice,
        item:itemId(name, readableId)
      `
      )
      .in("shipmentId", shipmentIds),
    customerIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : client
          .from("customerLocation")
          .select(
            `
            id, customerId,
            address:addressId(addressLine1, addressLine2, city, stateProvince, postalCode, countryCode, phone)
          `
          )
          .in("customerId", customerIds)
          .order("id", { ascending: true }),
    client
      .from("parcel")
      .select("shipmentId, length, width, height, weight")
      .in("shipmentId", shipmentIds)
  ]);

  if (linesRes.error) {
    throw new Error(`Failed to load shipment lines: ${linesRes.error.message}`);
  }
  if (locationsRes.error) {
    throw new Error(
      `Failed to load customer locations: ${locationsRes.error.message}`
    );
  }
  if (parcelsRes.error) {
    throw new Error(`Failed to load parcels: ${parcelsRes.error.message}`);
  }

  const linesByShipment = new Map<
    string,
    NonNullable<typeof linesRes.data>[number][]
  >();
  for (const ln of linesRes.data ?? []) {
    const arr = linesByShipment.get(ln.shipmentId) ?? [];
    arr.push(ln);
    linesByShipment.set(ln.shipmentId, arr);
  }

  // First location per customer is the default — same convention as the
  // FDW contract view on the Shelf side. Promote to an explicit
  // `is_default` flag if that ever stops being true.
  type LocationRow = NonNullable<typeof locationsRes.data>[number];
  const locationByCustomer = new Map<string, LocationRow>();
  for (const loc of (locationsRes.data ?? []) as LocationRow[]) {
    if (!loc.customerId) continue;
    if (!locationByCustomer.has(loc.customerId)) {
      locationByCustomer.set(loc.customerId, loc);
    }
  }

  const parcelsByShipment = new Map<
    string,
    NonNullable<typeof parcelsRes.data>[number][]
  >();
  for (const p of parcelsRes.data ?? []) {
    const arr = parcelsByShipment.get(p.shipmentId) ?? [];
    arr.push(p);
    parcelsByShipment.set(p.shipmentId, arr);
  }

  return shipments.map((s) => {
    const customerName =
      (s.customer as { name?: string } | null)?.name ?? "Unknown Customer";
    const location = s.customerId
      ? (locationByCustomer.get(s.customerId) ?? null)
      : null;
    const addr =
      (location?.address as {
        addressLine1: string | null;
        addressLine2: string | null;
        city: string | null;
        stateProvince: string | null;
        postalCode: string | null;
        countryCode: string | null;
        phone: string | null;
      } | null) ?? null;
    const shipTo = resolveShipTo(customerName, addr);
    const lines = linesByShipment.get(s.id) ?? [];
    const parcels = parcelsByShipment.get(s.id) ?? [];
    const items: ShipstationItem[] = lines.map((ln) => {
      const item =
        (ln.item as {
          name?: string;
          readableId?: string;
        } | null) ?? null;
      return {
        sku: item?.readableId ?? ln.itemId,
        name: item?.name ?? item?.readableId ?? "Item",
        weightOz: null,
        lengthIn: null,
        widthIn: null,
        heightIn: null,
        quantity: Number(ln.shippedQuantity ?? 0) || 1,
        unitPrice: Number(ln.unitPrice ?? 0)
      };
    });

    // If the operator pre-filled parcel weight + dims in Carbon, pass
    // the aggregate to Shipstation as a top-level weight on the first
    // item. Shipstation lets the operator override at label time.
    if (parcels.length > 0 && items.length > 0) {
      const totalWeightOz = parcels.reduce(
        (acc, p) => acc + (Number(p.weight) || 0),
        0
      );
      const biggest = parcels.reduce<(typeof parcels)[number] | null>(
        (best, p) =>
          best == null ||
          Number(p.length) * Number(p.width) * Number(p.height) >
            Number(best.length) * Number(best.width) * Number(best.height)
            ? p
            : best,
        null
      );
      items[0] = {
        ...items[0],
        weightOz: totalWeightOz > 0 ? totalWeightOz : null,
        lengthIn: biggest ? Number(biggest.length) || null : null,
        widthIn: biggest ? Number(biggest.width) || null : null,
        heightIn: biggest ? Number(biggest.height) || null : null
      };
    }

    const internalNotes = jsonbToText(s.internalNotes);
    const externalNotes = jsonbToText(s.externalNotes);

    return {
      orderNumber: s.shipmentId,
      orderDate: s.createdAt,
      lastModified: s.updatedAt ?? s.createdAt,
      orderStatus: s.status === "Voided" ? "cancelled" : "awaiting_shipment",
      shippingMethod:
        (s.shippingMethod as { name?: string } | null)?.name ?? "Standard",
      customerNotes: externalNotes,
      internalNotes,
      customer: {
        customerCode: s.customerId ?? "anonymous",
        name: customerName,
        company: customerName,
        email: null,
        phone: shipTo.phone,
        shipTo
      },
      items
    } satisfies ShipstationOrder;
  });
}

/**
 * Builds the structured ship-to from the customer's first address row.
 * Empty fields collapse to `""` rather than null — Shipstation accepts
 * blank line2 but treats missing required fields as a hard validation
 * error.
 */
function resolveShipTo(
  customerName: string,
  addr: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    stateProvince: string | null;
    postalCode: string | null;
    countryCode: string | null;
    phone: string | null;
  } | null
): ShipstationAddress {
  return {
    name: customerName,
    company: customerName,
    line1: addr?.addressLine1 ?? "",
    line2: addr?.addressLine2 ?? null,
    city: addr?.city ?? "",
    state: addr?.stateProvince ?? "",
    postalCode: addr?.postalCode ?? "",
    country: addr?.countryCode ?? "US",
    phone: addr?.phone ?? null
  };
}

/**
 * The notes columns are JSONB (TipTap doc shape). Flatten to plain text
 * for Shipstation's free-text notes fields. Empty input → null.
 */
function jsonbToText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const text = extractText(value).trim();
  return text.length > 0 ? text : null;
}

function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const anyNode = node as { text?: string; content?: unknown[] };
  if (typeof anyNode.text === "string") return anyNode.text;
  if (Array.isArray(anyNode.content)) {
    return anyNode.content.map(extractText).join(" ");
  }
  return "";
}

// =============================================================================
// XML serialization — Shipstation Custom Store schema
// =============================================================================

export function serializeOrdersXml(orders: ShipstationOrder[]): string {
  const body = orders.map(renderOrder).join("");
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Orders pages="1">${body}</Orders>`;
}

function renderOrder(o: ShipstationOrder): string {
  const items = o.items.map(renderItem).join("");
  return [
    "<Order>",
    el("OrderNumber", o.orderNumber),
    el("OrderDate", toShipstationDate(o.orderDate)),
    el("OrderStatus", o.orderStatus),
    el("LastModified", toShipstationDate(o.lastModified)),
    el("ShippingMethod", o.shippingMethod),
    el("PaymentMethod", "Net 30"),
    el("OrderTotal", computeOrderTotal(o).toFixed(2)),
    el("TaxAmount", "0.00"),
    el("ShippingAmount", "0.00"),
    el("CustomerNotes", o.customerNotes ?? ""),
    el("InternalNotes", o.internalNotes ?? ""),
    el("Gift", "false"),
    renderCustomer(o),
    `<Items>${items}</Items>`,
    "</Order>"
  ].join("");
}

function renderCustomer(o: ShipstationOrder): string {
  const { customer } = o;
  return [
    "<Customer>",
    el("CustomerCode", customer.customerCode),
    "<BillTo>",
    el("Name", customer.name),
    el("Company", customer.company ?? ""),
    el("Phone", customer.phone ?? ""),
    el("Email", customer.email ?? ""),
    "</BillTo>",
    "<ShipTo>",
    el("Name", customer.shipTo.name),
    el("Company", customer.shipTo.company ?? ""),
    el("Address1", customer.shipTo.line1),
    el("Address2", customer.shipTo.line2 ?? ""),
    el("City", customer.shipTo.city),
    el("State", customer.shipTo.state),
    el("PostalCode", customer.shipTo.postalCode),
    el("Country", customer.shipTo.country),
    el("Phone", customer.shipTo.phone ?? ""),
    "</ShipTo>",
    "</Customer>"
  ].join("");
}

function renderItem(i: ShipstationItem): string {
  const weight =
    i.weightOz != null
      ? `${el("Weight", i.weightOz.toString())}${el("WeightUnits", "Ounces")}`
      : "";
  const dim =
    i.lengthIn == null && i.widthIn == null && i.heightIn == null
      ? ""
      : [
          "<Options><Option>",
          el("Name", "Dimensions"),
          el(
            "Value",
            `${i.lengthIn ?? 0}x${i.widthIn ?? 0}x${i.heightIn ?? 0} in`
          ),
          "</Option></Options>"
        ].join("");
  return [
    "<Item>",
    el("SKU", i.sku),
    el("Name", i.name),
    el("Quantity", i.quantity.toString()),
    el("UnitPrice", i.unitPrice.toFixed(2)),
    weight,
    dim,
    "</Item>"
  ].join("");
}

function computeOrderTotal(o: ShipstationOrder): number {
  return o.items.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
}

function el(name: string, value: string): string {
  return `<${name}>${xmlEscape(value)}</${name}>`;
}

function toShipstationDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    fmt.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")}/${get("year")} ${pad(
    Number(get("hour")) % 24
  )}:${get("minute")}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
