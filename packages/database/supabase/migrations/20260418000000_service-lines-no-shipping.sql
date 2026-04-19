-- Service line items (design time, project management, etc.) should be
-- invoiceable but not shippable. Update quantityToSend to zero out for
-- Service lines, matching the existing Comment line behavior.
--
-- The quantityToSend column is a generated column referenced by two views
-- that must be dropped first and recreated after the column change.

-- Drop dependent views
DROP VIEW IF EXISTS "salesOrderLines";
DROP VIEW IF EXISTS "openSalesOrderLines";

-- Recreate quantityToSend to exclude Service lines from shipping
ALTER TABLE "salesOrderLine"
  DROP COLUMN IF EXISTS "quantityToSend",
  ADD COLUMN "quantityToSend" NUMERIC(16,5) GENERATED ALWAYS AS (
    CASE WHEN "salesOrderLineType" IN ('Comment', 'Service') THEN 0
    ELSE GREATEST(("saleQuantity" - "quantitySent"), 0)
    END
  ) STORED;

-- Recreate salesOrderLines view
CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision",
    so."orderDate",
    so."customerId",
    so."salesOrderId" as "salesOrderReadableId"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
);

-- Recreate openSalesOrderLines view
CREATE OR REPLACE VIEW "openSalesOrderLines" WITH (security_invoker=true) AS (
  SELECT
    sol."id",
    sol."salesOrderId",
    sol."itemId",
    sol."promisedDate",
    sol."methodType",
    sol."unitOfMeasureCode",
    sol."quantityToSend",
    sol."salesOrderLineType",
    sol."companyId",
    COALESCE(sol."locationId", so."locationId") AS "locationId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so ON sol."salesOrderId" = so."id"
  INNER JOIN "item" i ON sol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE
    sol."salesOrderLineType" != 'Service'
    AND sol."methodType" != 'Make'
    AND so."status" IN ('To Ship', 'To Ship and Invoice')
);
