CREATE TABLE "reminderLog" (
  "id" TEXT NOT NULL DEFAULT id('rml'),
  "companyId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "reminderType" TEXT NOT NULL,
  "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "reminderLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reminderLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "reminderLog_dedup_idx" ON "reminderLog"("documentType", "documentId", "reminderType");
