-- Phase 1: Proof Approval Flow
-- Adds proof approval gating before job release to production.
-- All jobs enter "Awaiting Proof Approval" status before "Ready".
-- Customers can approve/reject proofs via external share links.

-- 1. Add new job status
ALTER TYPE "jobStatus" ADD VALUE IF NOT EXISTS 'Awaiting Proof Approval';

-- 2. Add ProofApproval to external link document types
ALTER TYPE "externalLinkDocumentType" ADD VALUE IF NOT EXISTS 'ProofApproval';

-- 3. Create proof approval status enum
CREATE TYPE "proofApprovalStatus" AS ENUM (
  'Pending',
  'Approved',
  'Rejected',
  'Superseded'
);

-- 4. Create proofApproval table
CREATE TABLE "proofApproval" (
  "id" TEXT NOT NULL DEFAULT id('prf'),
  "jobId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "modelUploadId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "proofApprovalStatus" NOT NULL DEFAULT 'Pending',
  "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "requestedBy" TEXT NOT NULL,
  "decidedAt" TIMESTAMP WITH TIME ZONE,
  "decidedBy" TEXT,
  "decidedByEmail" TEXT,
  "decisionNotes" TEXT,
  "externalLinkId" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "proofApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proofApproval_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "proofApproval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "proofApproval_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "user"("id"),
  CONSTRAINT "proofApproval_externalLinkId_fkey" FOREIGN KEY ("externalLinkId") REFERENCES "externalLink"("id") ON DELETE SET NULL
);

-- 5. Indexes
CREATE INDEX "proofApproval_jobId_idx" ON "proofApproval"("jobId");
CREATE INDEX "proofApproval_companyId_idx" ON "proofApproval"("companyId");
CREATE INDEX "proofApproval_status_idx" ON "proofApproval"("status");
CREATE INDEX "proofApproval_externalLinkId_idx" ON "proofApproval"("externalLinkId");

-- 6. Enable RLS
ALTER TABLE "proofApproval" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "proofApproval"
  FOR SELECT
  USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  );

CREATE POLICY "INSERT" ON "proofApproval"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "proofApproval"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "proofApproval"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('production_delete'))::text[]
    )
  );

