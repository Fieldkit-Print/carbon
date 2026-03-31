ALTER TABLE "salesRfq" ADD COLUMN IF NOT EXISTS "emailId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "salesRfq_emailId_companyId_idx" ON "salesRfq" ("emailId", "companyId") WHERE "emailId" IS NOT NULL;
