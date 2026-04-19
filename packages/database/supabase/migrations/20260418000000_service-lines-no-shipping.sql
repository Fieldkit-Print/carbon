-- Service line items (design time, project management, etc.) should be
-- invoiceable but not shippable. Update quantityToSend to zero out for
-- Service lines, matching the existing Comment line behavior.

ALTER TABLE "salesOrderLine"
  DROP COLUMN IF EXISTS "quantityToSend",
  ADD COLUMN "quantityToSend" NUMERIC(16,5) GENERATED ALWAYS AS (
    CASE WHEN "salesOrderLineType" IN ('Comment', 'Service') THEN 0
    ELSE GREATEST(("saleQuantity" - "quantitySent"), 0)
    END
  ) STORED;
