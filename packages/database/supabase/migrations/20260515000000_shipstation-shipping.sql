-- =============================================================================
-- Shipstation Phase 2 — Custom Store columns on shipment + parcel
--
-- Adds the columns the Shipstation Custom Store integration populates
-- on Carbon shipments. Operators no longer rate-shop inside Carbon —
-- shipments are exported to Shipstation as orders, the operator buys
-- the label there, and Shipstation's shipnotify pushes back the
-- tracking number + cost data we record here.
--
-- The existing easypost* columns are intentionally NOT dropped in this
-- migration. They stay to make a clean cutover possible (rollback /
-- coexistence window). A follow-up migration after the Shipstation
-- flow is verified in production will drop them.
-- =============================================================================

-- shipment: header-level Shipstation state. The header always has the
-- order_number (BR-style: SHP-<id>), and after labels are bought the
-- header gets aggregate cost + the carrier/service that won the
-- rate shop in Shipstation. trackingNumber already exists on shipment
-- (Easypost wrote there too); Shipstation will populate the same column.
ALTER TABLE "shipment"
  ADD COLUMN "shipstationOrderId"       TEXT,
  ADD COLUMN "shipstationShipmentId"    TEXT,
  ADD COLUMN "shipstationCarrierCode"   TEXT,
  ADD COLUMN "shipstationServiceCode"   TEXT,
  ADD COLUMN "shipstationShipmentCost"  NUMERIC(10, 2),
  ADD COLUMN "shipstationInsuranceCost" NUMERIC(10, 2),
  ADD COLUMN "shipstationShippedAt"     TIMESTAMP WITH TIME ZONE;

-- parcel: per-parcel Shipstation state for multi-parcel orders. Each
-- parcel becomes its own label in Shipstation, with its own cost and
-- tracking number. The aggregate cost on `shipment` is the sum.
ALTER TABLE "parcel"
  ADD COLUMN "shipstationShipmentId"   TEXT,
  ADD COLUMN "shipstationShipmentCost" NUMERIC(10, 2);

-- Lookup index: shipnotify pings carry order_number; we resolve to a
-- shipment.id via the readable id ("shipmentId" column, e.g. SHP-00042).
-- The unique constraint on (companyId, shipmentId) already exists, so
-- this index is just a secondary path for the API client's filter
-- predicates.
CREATE INDEX IF NOT EXISTS "shipment_shipstationOrderId_idx"
  ON "shipment" ("shipstationOrderId")
  WHERE "shipstationOrderId" IS NOT NULL;
