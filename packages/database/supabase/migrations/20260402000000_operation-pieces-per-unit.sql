-- Add piecesPerUnit to operations for n-up/ganging support.
-- This allows operations like printing to specify that one production pass
-- produces multiple finished pieces (e.g., 3-up ganging on a wide format printer).

ALTER TABLE "methodOperation"
  ADD COLUMN "piecesPerUnit" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "quoteOperation"
  ADD COLUMN "piecesPerUnit" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "jobOperation"
  ADD COLUMN "piecesPerUnit" INTEGER NOT NULL DEFAULT 1;
