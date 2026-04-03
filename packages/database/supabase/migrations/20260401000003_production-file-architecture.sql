-- Lock field on modelUpload — prevents changes to production file after job release
ALTER TABLE "modelUpload" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;

-- Sub-production file per job operation
ALTER TABLE "jobOperation" ADD COLUMN "modelUploadId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_modelUploadId_fkey"
  FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "jobOperation_modelUploadId_idx" ON "jobOperation" ("modelUploadId");

-- Process plan config on work center (.kfpx filename for PDF Toolbox)
ALTER TABLE "workCenter" ADD COLUMN "processPlanPath" TEXT;
