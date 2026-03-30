ALTER TABLE "salesRfq" ADD COLUMN "emailId" TEXT;
CREATE UNIQUE INDEX "salesRfq_emailId_companyId_idx" ON "salesRfq" ("emailId", "companyId") WHERE "emailId" IS NOT NULL;
