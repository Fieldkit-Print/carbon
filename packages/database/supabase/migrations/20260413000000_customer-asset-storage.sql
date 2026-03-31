-- Add customerId to item table for customer-owned assets
ALTER TABLE "item" ADD COLUMN "customerId" TEXT REFERENCES "customer"("id") ON DELETE SET NULL;
CREATE INDEX "item_customerId_idx" ON "item"("customerId") WHERE "customerId" IS NOT NULL;

-- Movement event log for customer assets
CREATE TABLE "customerAssetEvent" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventDate" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "sourceDocument" TEXT,
  "sourceDocumentId" TEXT,
  "destination" TEXT,
  "notes" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "customerAssetEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customerAssetEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "customerAssetEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "customerAssetEvent_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX "customerAssetEvent_itemId_idx" ON "customerAssetEvent"("itemId");
CREATE INDEX "customerAssetEvent_companyId_idx" ON "customerAssetEvent"("companyId");

ALTER TABLE "customerAssetEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with inventory_view can view customer asset events" ON "customerAssetEvent"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('inventory_view', "companyId")
  );

CREATE POLICY "Employees with inventory_create can insert customer asset events" ON "customerAssetEvent"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('inventory_create', "companyId")
  );

CREATE POLICY "Employees with inventory_update can update customer asset events" ON "customerAssetEvent"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('inventory_update', "companyId")
  );

CREATE POLICY "Employees with inventory_delete can delete customer asset events" ON "customerAssetEvent"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('inventory_delete', "companyId")
  );

-- Recreate parts view to include customerId
CREATE OR REPLACE VIEW "parts" WITH (SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId")
    i.*,
    mu.id as "modelUploadId",

    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'name', i."name",
        'description', i."description",
        'active', i."active",
        'createdAt', i."createdAt"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  li."customerId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",

  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  p."customFields",
  p."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "part" p
INNER JOIN latest_items li ON li."readableId" = p."id" AND li."companyId" = p."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = p."id" AND ir."companyId" = p."companyId"
LEFT JOIN (
  SELECT
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;

-- Recreate get_part_details to include customerId
DROP FUNCTION IF EXISTS get_part_details;
CREATE OR REPLACE FUNCTION get_part_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "name" TEXT,
    "replenishmentSystem" "itemReplenishmentSystem",
    "unitOfMeasureCode" TEXT,
    "notes" JSONB,
    "thumbnailPath" TEXT,
    "modelId" TEXT,
    "modelPath" TEXT,
    "modelName" TEXT,
    "modelSize" BIGINT,
    "id" TEXT,
    "companyId" TEXT,
    "customerId" TEXT,
    "unitOfMeasure" TEXT,
    "readableId" TEXT,
    "revision" TEXT,
    "readableIdWithRevision" TEXT,
    "revisions" JSON,
    "customFields" JSONB,
    "tags" TEXT[],
    "itemPostingGroupId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_readable_id TEXT;
  v_company_id TEXT;
BEGIN
  -- First get the readableId and companyId for the item
  SELECT i."readableId", i."companyId" INTO v_readable_id, v_company_id
  FROM "item" i
  WHERE i.id = item_id;

  RETURN QUERY
  WITH item_revisions AS (
    SELECT
      json_agg(
        json_build_object(
          'id', i.id,
          'revision', i."revision",
          'methodType', i."defaultMethodType",
          'type', i."type"
        ) ORDER BY
          i."createdAt" DESC
      ) as "revisions"
    FROM "item" i
    WHERE i."readableId" = v_readable_id
    AND i."companyId" = v_company_id
  )
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."name",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    i."notes",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    mu.id as "modelId",
    mu."modelPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    i."id",
    i."companyId",
    i."customerId",
    uom.name as "unitOfMeasure",
    i."readableId",
    i."revision",
    i."readableIdWithRevision",
    ir."revisions",
    p."customFields",
    p."tags",
    ic."itemPostingGroupId",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt"
  FROM "part" p
  LEFT JOIN "item" i ON i."readableId" = p."id" AND i."companyId" = p."companyId"
  LEFT JOIN item_revisions ir ON true
  LEFT JOIN (
    SELECT
      ps."itemId",
      string_agg(ps."supplierPartId", ',') AS "supplierIds"
    FROM "supplierPart" ps
    GROUP BY ps."itemId"
  ) ps ON ps."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  WHERE i."id" = item_id;
END;
$$ LANGUAGE plpgsql;
