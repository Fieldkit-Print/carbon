-- Add piecesPerUnit to quoteMaterial for n-up imposition support.
-- A value of 6 means each unit of this material produces 6 finished pieces
-- (e.g., 6 postcards per sheet). Default 1 preserves existing behavior.

ALTER TABLE "quoteMaterial"
  ADD COLUMN "piecesPerUnit" INTEGER NOT NULL DEFAULT 1;

-- Update get_quote_methods_by_method_id to include piecesPerUnit
DROP FUNCTION IF EXISTS get_quote_methods_by_method_id;
CREATE OR REPLACE FUNCTION get_quote_methods_by_method_id(mid TEXT)
RETURNS TABLE (
    "quoteId" TEXT,
    "quoteLineId" TEXT,
    "methodMaterialId" TEXT,
    "quoteMakeMethodId" TEXT,
    "quoteMaterialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "itemType" TEXT,
    "itemTrackingType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "shelfId" TEXT,
    "piecesPerUnit" INTEGER
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "quoteId",
        "quoteLineId",
        "id",
        "id" AS "quoteMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "quoteMaterialMakeMethodId",
        "version",
        "itemId",
        'Part' AS "itemType",
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit",
        NULL::TEXT AS "shelfId",
        1::INTEGER AS "piecesPerUnit"
    FROM
        "quoteMakeMethod"
    WHERE
        "id" = mid
    UNION
    SELECT
        child."quoteId",
        child."quoteLineId",
        child."id",
        child."quoteMakeMethodId",
        child."methodType",
        child."quoteMaterialMakeMethodId",
        child."version",
        child."itemId",
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot",
        child."kit",
        child."shelfId",
        child."piecesPerUnit"
    FROM
        "quoteMaterialWithMakeMethodId" child
        INNER JOIN material parent ON parent."quoteMaterialMakeMethodId" = child."quoteMakeMethodId"
    WHERE parent."methodType" = 'Make'
)
SELECT
  material."quoteId",
  material."quoteLineId",
  material.id as "methodMaterialId",
  material."quoteMakeMethodId",
  material."quoteMaterialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."name" AS "description",
  item."unitOfMeasureCode",
  material."itemType",
  item."itemTrackingType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot",
  material."kit",
  item."revision",
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
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  material."version",
  material."shelfId",
  material."piecesPerUnit"
FROM material
INNER JOIN item ON material."itemId" = item.id
ORDER BY "order"
$$ LANGUAGE sql STABLE;


-- Update get_quote_methods to include piecesPerUnit
DROP FUNCTION IF EXISTS get_quote_methods;
CREATE OR REPLACE FUNCTION get_quote_methods(qid TEXT)
RETURNS TABLE (
    "quoteId" TEXT,
    "quoteLineId" TEXT,
    "methodMaterialId" TEXT,
    "quoteMakeMethodId" TEXT,
    "quoteMaterialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "shelfId" TEXT,
    "piecesPerUnit" INTEGER
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "quoteId",
        "quoteLineId",
        "id",
        "id" AS "quoteMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "quoteMaterialMakeMethodId",
        "itemId",
        'Part' AS "itemType",
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit",
        "version",
        NULL::TEXT AS "shelfId",
        1::INTEGER AS "piecesPerUnit"
    FROM
        "quoteMakeMethod"
    WHERE
        "quoteId" = qid
        AND "parentMaterialId" IS NULL
    UNION
    SELECT
        child."quoteId",
        child."quoteLineId",
        child."id",
        child."quoteMakeMethodId",
        child."methodType",
        child."quoteMaterialMakeMethodId",
        child."itemId",
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot",
        child."kit",
        child."version",
        child."shelfId",
        child."piecesPerUnit"
    FROM
        "quoteMaterialWithMakeMethodId" child
        INNER JOIN material parent ON parent."quoteMaterialMakeMethodId" = child."quoteMakeMethodId"
)
SELECT
  material."quoteId",
  material."quoteLineId",
  material.id as "methodMaterialId",
  material."quoteMakeMethodId",
  material."quoteMaterialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."name" AS "description",
  material."itemType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot",
  material."kit",
  item."revision",
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
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  material."version",
  material."shelfId",
  material."piecesPerUnit"
FROM material
INNER JOIN item ON material."itemId" = item.id
WHERE material."quoteId" = qid
ORDER BY "order"
$$ LANGUAGE sql STABLE;
