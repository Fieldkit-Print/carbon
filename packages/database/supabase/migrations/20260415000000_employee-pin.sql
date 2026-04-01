ALTER TABLE "employee" ADD COLUMN "pinHash" TEXT DEFAULT NULL;

ALTER TABLE "employee"
  ADD CONSTRAINT "employee_pinHash_companyId_unique"
  UNIQUE ("pinHash", "companyId");
