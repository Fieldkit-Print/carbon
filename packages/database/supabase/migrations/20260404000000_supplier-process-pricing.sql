-- Drop and recreate view to allow column changes
DROP VIEW IF EXISTS "supplierProcesses";

-- Add setupCost to supplierProcess (unitCost was intentionally removed — do NOT re-add)
ALTER TABLE "supplierProcess"
  ADD COLUMN "setupCost" NUMERIC(15,5) NOT NULL DEFAULT 0;

-- Recreate view
CREATE VIEW "supplierProcesses" WITH(SECURITY_INVOKER=true) AS
  SELECT sp.*, p.name as "processName"
  FROM "supplierProcess" sp
  INNER JOIN "process" p ON sp."processId" = p.id;

-- Price breaks table (mirrors supplierPartPrice)
CREATE TABLE "supplierProcessPrice" (
  "supplierProcessId" TEXT NOT NULL,
  "quantity" NUMERIC(20,2) NOT NULL DEFAULT 1,
  "unitPrice" NUMERIC(15,5) NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMPTZ,

  CONSTRAINT "supplierProcessPrice_pkey"
    PRIMARY KEY ("supplierProcessId", "quantity"),
  CONSTRAINT "supplierProcessPrice_supplierProcessId_fkey"
    FOREIGN KEY ("supplierProcessId") REFERENCES "supplierProcess"("id")
    ON DELETE CASCADE,
  CONSTRAINT "supplierProcessPrice_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "supplierProcessPrice_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "supplierProcessPrice_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

ALTER TABLE "supplierProcessPrice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees with purchasing_view can view supplier process prices"
  ON "supplierProcessPrice" FOR SELECT USING (
    has_role('employee', "companyId")
    AND has_company_permission('purchasing_view', "companyId")
  );
CREATE POLICY "Employees with purchasing_create can create supplier process prices"
  ON "supplierProcessPrice" FOR INSERT WITH CHECK (
    has_role('employee', "companyId")
    AND has_company_permission('purchasing_create', "companyId")
  );
CREATE POLICY "Employees with purchasing_update can update supplier process prices"
  ON "supplierProcessPrice" FOR UPDATE USING (
    has_role('employee', "companyId")
    AND has_company_permission('purchasing_update', "companyId")
  );
CREATE POLICY "Employees with purchasing_delete can delete supplier process prices"
  ON "supplierProcessPrice" FOR DELETE USING (
    has_role('employee', "companyId")
    AND has_company_permission('purchasing_delete', "companyId")
  );

-- Add-on fees table
CREATE TABLE "supplierProcessAddon" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "supplierProcessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "feeType" TEXT NOT NULL DEFAULT 'flat' CHECK ("feeType" IN ('flat', 'per-piece')),
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMPTZ,

  CONSTRAINT "supplierProcessAddon_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplierProcessAddon_supplierProcessId_fkey"
    FOREIGN KEY ("supplierProcessId") REFERENCES "supplierProcess"("id")
    ON DELETE CASCADE,
  CONSTRAINT "supplierProcessAddon_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "supplierProcessAddon" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees with purchasing_view can view supplier process addons"
  ON "supplierProcessAddon" FOR SELECT USING (
    has_role('employee', "companyId")
    AND has_company_permission('purchasing_view', "companyId")
  );
CREATE POLICY "Employees with purchasing_create can create supplier process addons"
  ON "supplierProcessAddon" FOR INSERT WITH CHECK (
    has_role('employee', "companyId")
    AND has_company_permission('purchasing_create', "companyId")
  );
CREATE POLICY "Employees with purchasing_update can update supplier process addons"
  ON "supplierProcessAddon" FOR UPDATE USING (
    has_role('employee', "companyId")
    AND has_company_permission('purchasing_update', "companyId")
  );
CREATE POLICY "Employees with purchasing_delete can delete supplier process addons"
  ON "supplierProcessAddon" FOR DELETE USING (
    has_role('employee', "companyId")
    AND has_company_permission('purchasing_delete', "companyId")
  );

-- Add operationSetupCost to job, quote, and method operations
ALTER TABLE "jobOperation"
  ADD COLUMN "operationSetupCost" NUMERIC(15,5) NOT NULL DEFAULT 0;
ALTER TABLE "quoteOperation"
  ADD COLUMN "operationSetupCost" NUMERIC(15,5) NOT NULL DEFAULT 0;
ALTER TABLE "methodOperation"
  ADD COLUMN "operationSetupCost" NUMERIC(15,5) NOT NULL DEFAULT 0;
