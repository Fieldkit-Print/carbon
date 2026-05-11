-- =============================================================================
-- Warehouse pricing — rate card for Shelf-driven billing events
--
-- Backs the Fieldkit ↔ Shelf integration: Shelf emits BillableEvent rows
-- (storage day, pick, return, rental day, rental loss, consumable use) and
-- POSTs each to Carbon. Carbon resolves the rate from this table and writes
-- a `Fee` line to the customer's current monthly draft invoice.
--
-- Resolution: most-specific match wins, scored by which of
-- (customerId, locationId, itemId) are non-null and match the lookup.
-- A catch-all row (all three columns NULL) is the fallback default.
--
-- See `public.resolve_warehouse_price()` below.
-- =============================================================================

CREATE TABLE "warehousePrice" (
  "id"             TEXT NOT NULL DEFAULT xid(),
  "companyId"      TEXT NOT NULL,
  "pricingKind"    TEXT NOT NULL,
  -- Specificity dimensions; NULL = "applies regardless of this dimension."
  "customerId"     TEXT,
  "locationId"     TEXT,
  "itemId"         TEXT,
  -- Amount in invoice units (matches salesInvoiceLine.unitPrice convention,
  -- NUMERIC(15,2)). The billing endpoint converts cents → dollars on write.
  "amount"         NUMERIC(15,2) NOT NULL,
  "currencyCode"   TEXT NOT NULL,
  -- Time bounds for rate changes. effectiveTo NULL = "in force until further notice."
  "effectiveFrom"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "effectiveTo"    TIMESTAMP WITH TIME ZONE,
  "description"    TEXT,
  "customFields"   JSONB,
  "createdBy"      TEXT NOT NULL,
  "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy"      TEXT,
  "updatedAt"      TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "warehousePrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "warehousePrice_kind_check" CHECK (
    "pricingKind" IN (
      'storage_day',
      'pick_fee',
      'return_fee',
      'rental_day',
      'rental_loss',
      'consumable_use'
    )
  ),
  CONSTRAINT "warehousePrice_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "warehousePrice_effectiveBounds_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "warehousePrice_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "warehousePrice_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE,
  CONSTRAINT "warehousePrice_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "warehousePrice_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "warehousePrice_currencyCode_fkey"
    FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "warehousePrice_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "warehousePrice_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE SET NULL
);

-- Fast lookup path used by the resolver: (companyId, pricingKind) is the
-- common filter; specificity columns are inspected per-row after that.
CREATE INDEX "warehousePrice_company_kind_idx"
  ON "warehousePrice"("companyId", "pricingKind");

CREATE INDEX "warehousePrice_customerId_idx"
  ON "warehousePrice"("customerId") WHERE "customerId" IS NOT NULL;

CREATE INDEX "warehousePrice_locationId_idx"
  ON "warehousePrice"("locationId") WHERE "locationId" IS NOT NULL;

CREATE INDEX "warehousePrice_itemId_idx"
  ON "warehousePrice"("itemId") WHERE "itemId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Idempotency support for Shelf-driven invoice lines.
--
-- The `/api/billing/line-items` endpoint stores Shelf's `idempotencyKey` in
-- `salesInvoiceLine.customFields->>'shelfBillableEventId'` so retries dedupe.
-- This partial expression index makes that lookup constant-time.
-- -----------------------------------------------------------------------------
CREATE INDEX "salesInvoiceLine_shelfBillableEventId_idx"
  ON "salesInvoiceLine"((("customFields"->>'shelfBillableEventId')))
  WHERE "customFields"->>'shelfBillableEventId' IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Resolver: returns the best-matching warehousePrice row for a given
-- (kind, customer, location, item) tuple at a given time.
--
-- Ranking score:
--   customerId matches  → +4
--   locationId matches  → +2
--   itemId matches      → +1
--   NULL in a column means "this dimension doesn't constrain the rate";
--   only an active row whose non-NULL dimensions all match is considered.
--
-- The highest score within the company's rate card wins. Ties are broken
-- by the most recent effectiveFrom (lets you stage a rate change ahead of
-- time and have it take over automatically).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_warehouse_price(
  p_company_id     TEXT,
  p_pricing_kind   TEXT,
  p_customer_id    TEXT,
  p_location_id    TEXT,
  p_item_id        TEXT,
  p_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  "amount"        NUMERIC(15,2),
  "currencyCode"  TEXT,
  "priceId"       TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wp."amount",
    wp."currencyCode",
    wp."id"
  FROM "warehousePrice" wp
  WHERE wp."companyId"   = p_company_id
    AND wp."pricingKind" = p_pricing_kind
    AND wp."effectiveFrom" <= p_at
    AND (wp."effectiveTo" IS NULL OR wp."effectiveTo" > p_at)
    -- Every non-NULL specificity column must match the lookup. NULL means
    -- "wildcard" and matches anything.
    AND (wp."customerId" IS NULL OR wp."customerId" = p_customer_id)
    AND (wp."locationId" IS NULL OR wp."locationId" = p_location_id)
    AND (wp."itemId"     IS NULL OR wp."itemId"     = p_item_id)
  ORDER BY
    (
      (CASE WHEN wp."customerId" IS NOT NULL THEN 4 ELSE 0 END)
    + (CASE WHEN wp."locationId" IS NOT NULL THEN 2 ELSE 0 END)
    + (CASE WHEN wp."itemId"     IS NOT NULL THEN 1 ELSE 0 END)
    ) DESC,
    wp."effectiveFrom" DESC
  LIMIT 1;
END;
$$;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE "warehousePrice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "warehousePrice"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  );

CREATE POLICY "INSERT" ON "warehousePrice"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "warehousePrice"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "warehousePrice"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
    )
  );

-- -----------------------------------------------------------------------------
-- Shelf-side FDW contract view
-- =============================================================================
-- The view in `public_api.v1_warehouse_pricing` (set up by
-- shelf/apps/webapp/app/modules/carbon-sync/docs/CONTRACT_VIEWS_CARBON.sql)
-- is updated below to project from this real table instead of the empty
-- placeholder. Idempotent CREATE OR REPLACE — safe to run after the
-- contract-views file is in place.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'public_api'
  ) THEN
    -- public_api schema already exists (Carson ran CONTRACT_VIEWS_CARBON.sql).
    -- Redefine the warehouse-pricing view to project from the new table.
    EXECUTE $view$
      CREATE OR REPLACE VIEW public_api.v1_warehouse_pricing AS
        SELECT
          wp."id"             AS id,
          wp."companyId"      AS company_id,
          wp."pricingKind"    AS pricing_kind,
          wp."customerId"     AS customer_id,
          wp."locationId"     AS location_id,
          wp."itemId"         AS carbon_part_id,
          wp."amount"         AS amount,
          wp."currencyCode"   AS currency_code,
          wp."effectiveFrom"  AS effective_from,
          wp."effectiveTo"    AS effective_to,
          wp."description"    AS description
        FROM public."warehousePrice" wp;
    $view$;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shelf_fdw_reader') THEN
      EXECUTE 'GRANT SELECT ON public_api.v1_warehouse_pricing TO shelf_fdw_reader';
    END IF;
  END IF;
END
$$;
