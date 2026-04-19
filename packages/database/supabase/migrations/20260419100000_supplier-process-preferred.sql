-- Drop and recreate view to allow column changes
DROP VIEW IF EXISTS "supplierProcesses";

ALTER TABLE "supplierProcess"
  ADD COLUMN "isPreferred" BOOLEAN NOT NULL DEFAULT false;

-- Only one preferred supplier per (companyId, processId)
CREATE UNIQUE INDEX "supplierProcess_preferred_unique"
  ON "supplierProcess" ("companyId", "processId")
  WHERE "isPreferred" = true;

-- Recreate view
CREATE VIEW "supplierProcesses" WITH(SECURITY_INVOKER=true) AS
  SELECT sp.*, p.name as "processName"
  FROM "supplierProcess" sp
  INNER JOIN "process" p ON sp."processId" = p.id;
