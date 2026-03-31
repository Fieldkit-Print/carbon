-- Move grommet items from Part to Consumable
-- Removes orphaned part records and creates consumable records

DO $$
DECLARE
  grommet_ids TEXT[] := ARRAY[
    'GRM-2-NKL',
    'GRM-2-BLK',
    'GRM-2-ABRS',
    'GRM-3-NKL',
    'GRM-3-BLK',
    'GRM-3-ABRS'
  ];
BEGIN
  -- Update item type from Part to Consumable
  UPDATE "item"
  SET "type" = 'Consumable'
  WHERE "readableId" = ANY(grommet_ids)
    AND "type" = 'Part';

  -- Remove orphaned part records
  DELETE FROM "part"
  WHERE "id" = ANY(grommet_ids);

  -- Create consumable records (upsert to avoid conflicts if any already exist)
  INSERT INTO "consumable" ("id", "companyId", "createdBy")
  SELECT DISTINCT i."readableId", i."companyId", i."createdBy"
  FROM "item" i
  WHERE i."readableId" = ANY(grommet_ids)
    AND i."type" = 'Consumable'
  ON CONFLICT ("id", "companyId") DO NOTHING;
END $$;
