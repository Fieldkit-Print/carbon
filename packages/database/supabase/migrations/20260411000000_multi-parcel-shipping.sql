-- Multi-parcel shipping: move label/tracking to parcel level, add order support

-- Add per-parcel label and tracking columns
ALTER TABLE "parcel"
  ADD COLUMN "easypostShipmentId" TEXT,
  ADD COLUMN "trackingNumber" TEXT,
  ADD COLUMN "labelUrl" TEXT,
  ADD COLUMN "labelFormat" TEXT,
  ADD COLUMN "trackingStatus" TEXT,
  ADD COLUMN "trackingUpdatedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "estimatedDeliveryDate" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "selectedRate" JSONB;

-- Add EasyPost order ID to shipment for multi-parcel orders
ALTER TABLE "shipment"
  ADD COLUMN "easypostOrderId" TEXT;

-- Migrate existing shipment-level label data to the first parcel
UPDATE "parcel" p
SET
  "easypostShipmentId" = s."easypostShipmentId",
  "trackingNumber" = s."trackingNumber",
  "labelUrl" = s."labelUrl",
  "labelFormat" = s."labelFormat",
  "trackingStatus" = s."trackingStatus",
  "trackingUpdatedAt" = s."trackingUpdatedAt",
  "estimatedDeliveryDate" = s."estimatedDeliveryDate",
  "selectedRate" = s."selectedRate"
FROM "shipment" s
WHERE p."shipmentId" = s."id"
  AND s."labelUrl" IS NOT NULL
  AND p."id" = (
    SELECT p2."id" FROM "parcel" p2
    WHERE p2."shipmentId" = s."id"
    ORDER BY p2."createdAt" ASC
    LIMIT 1
  );
