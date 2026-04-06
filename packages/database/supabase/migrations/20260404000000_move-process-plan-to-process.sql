-- Move processPlanPath from workCenter to process table
-- The .kfpx process plan belongs on the process (e.g., "Digital Printing")
-- not the work center (e.g., "Printer 1"), because the same machine may
-- run different processes with different PDF prep.

ALTER TABLE "process" ADD COLUMN "processPlanPath" TEXT;

-- Migrate existing data: copy from work center to linked processes
UPDATE "process" p
SET "processPlanPath" = wc."processPlanPath"
FROM "workCenterProcess" wcp
JOIN "workCenter" wc ON wc.id = wcp."workCenterId"
WHERE wcp."processId" = p.id
  AND wc."processPlanPath" IS NOT NULL;

ALTER TABLE "workCenter" DROP COLUMN "processPlanPath";
