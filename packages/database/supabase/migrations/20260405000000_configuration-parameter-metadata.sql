ALTER TABLE "configurationParameter"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "defaultValue" TEXT,
  ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT false;
