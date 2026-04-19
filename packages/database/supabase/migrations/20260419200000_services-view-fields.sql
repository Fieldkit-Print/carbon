DROP VIEW IF EXISTS "services";
CREATE OR REPLACE VIEW "services" WITH(SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId")
    i.*
  FROM "item" i
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
        'methodType', i."defaultMethodType",
        'type', i."type"
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
  li."thumbnailPath",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  s."serviceType",
  s."approved",
  s."approvedBy",
  s."fromDate",
  s."toDate",
  s."customFields",
  s."tags",
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
FROM "service" s
  INNER JOIN latest_items li ON li."readableId" = s."id" AND li."companyId" = s."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = s."id" AND ir."companyId" = li."companyId"
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
