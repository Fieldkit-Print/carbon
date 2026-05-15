/**
 * Shipstation Custom Store — Shared Types (Carbon side, Phase 2)
 *
 * Carbon publishes Pending shipments to Shipstation as orders via the
 * Custom Store XML schema. Once Shipstation prints a label, it pings
 * the shipnotify URL with order_number + tracking; the handler then
 * follows up with a Shipstation v1 REST call to fetch the shipment's
 * cost (which the shipnotify payload itself doesn't carry).
 *
 * @see {@link file://./export.server.ts}      Polling export endpoint
 * @see {@link file://./shipnotify.server.ts}  Shipnotify POST handler
 * @see {@link file://./client.server.ts}      Shipstation REST client (cost lookup)
 * @see https://help.shipstation.com/hc/en-us/articles/360025856212-Custom-Store
 */

/**
 * A Carbon shipment rendered for Shipstation's Custom Store. Field
 * names mirror Shipstation's XML schema where the mapping is direct;
 * camelCase is preserved on the TS side.
 */
export type ShipstationOrder = {
  /**
   * Stable identifier — Carbon's `shipment.shipmentId` (the
   * "SHP-000042" readable id). Shipstation uses this as its primary
   * key for the order; it never changes for a given shipment.
   */
  orderNumber: string;
  orderDate: string;
  lastModified: string;
  /** awaiting_shipment | cancelled | shipped */
  orderStatus: "awaiting_shipment" | "cancelled" | "shipped";
  shippingMethod: string;
  customerNotes: string | null;
  internalNotes: string | null;
  customer: ShipstationCustomer;
  items: ShipstationItem[];
};

export type ShipstationCustomer = {
  customerCode: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  shipTo: ShipstationAddress;
};

export type ShipstationAddress = {
  name: string;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
};

export type ShipstationItem = {
  /** Carbon item readableId — operator-facing SKU. */
  sku: string;
  name: string;
  weightOz: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  quantity: number;
  unitPrice: number;
};

/**
 * Body shape Shipstation POSTs to the shipnotify URL. Most fields
 * arrive on the query string; we normalize query + body into this
 * shape inside the handler. The cost is NOT carried here — we do a
 * follow-up Shipstation API call keyed on order_number.
 */
export type ShipstationShipnotify = {
  orderNumber: string;
  carrier: string | null;
  service: string | null;
  trackingNumber: string | null;
  shipDate: string | null;
  isReturn: boolean;
};

/**
 * Subset of the Shipstation v1 REST `GET /shipments` row we care
 * about. The full response is much larger; we project to the fields
 * that map onto Carbon's `shipment` + `parcel` columns.
 */
export type ShipstationApiShipment = {
  shipmentId: number;
  orderNumber: string;
  carrierCode: string | null;
  serviceCode: string | null;
  trackingNumber: string | null;
  shipDate: string | null;
  shipmentCost: number | null;
  insuranceCost: number | null;
};
