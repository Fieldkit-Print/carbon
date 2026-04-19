# Outsourced cost flow fixes

## Plan

### Fix 1 — UI preview setup cost
- [x] `apps/erp/app/modules/sales/ui/Quotes/useLineCosts.tsx:361-367`: add `operationSetupCost` to the outside-cost effect so the live preview matches the backend rollup.

### Fix 2 — Preferred supplier on process
- [x] Migration: add `isPreferred BOOLEAN NOT NULL DEFAULT false` to `supplierProcess`.
- [x] Partial unique index so only one preferred supplier per (companyId, processId) at a time.
- [x] Update `getRatesFromSupplierProcesses` in `packages/database/supabase/functions/lib/methods.ts` to prefer `isPreferred=true` before falling back to average. (get-method/functions/lib/methods.ts is a bundled artifact — not consumed, left alone.)
- [x] `SupplierProcessForm.tsx`: add Boolean toggle; `upsertSupplierProcess` service: clear other preferred rows for same process when setting one.

### Fix 3 — Lead time rollup
- [x] `packages/database/supabase/functions/lib/methods.ts`: replace hardcoded `leadTime: 0` with sum of `operationLeadTime` across outside operations in the tree.
- [x] `apps/erp/app/routes/x+/quote+/$quoteId.$lineId.recalculate-price.tsx`: same fix.
- [x] Preserve user-edited leadTime when recalculating — existing `upsertQuoteLinePrices` flow does this (line 2332).

### Fix 4 — Quantity-break preview in method design
- [x] New read-only preview component `SupplierProcessBreaksPreview` (fetches via new API endpoint `api/purchasing/supplier-process-detail/$id`).
- [x] Embedded in `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` after Lead Time when Outside.
- [x] Mirrored in `apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx`.

## Execution order
1. Fix 1 (smallest, immediate correctness gain) ✓
2. Fix 3 (medium, isolated backend change) ✓
3. Fix 2 (DB migration + multi-file) ✓
4. Fix 4 (new UI surface, depends on nothing else) ✓

## Review

- **Migration** `20260419100000_supplier-process-preferred.sql` drops and recreates the `supplierProcesses` view when adding the column, matching the pattern in the prior supplier-process-pricing migration. The partial unique index enforces one-preferred-per-process atomically at the DB level.
- **`upsertSupplierProcess`** clears any other `isPreferred=true` row for the same `(companyId, processId)` before the write. On update, it looks up the existing `companyId` first (since it's not in the payload). Both paths avoid clearing the row being written.
- **`getRatesFromSupplierProcesses`** now checks for a preferred supplier in the `processId` group before falling back to averaging across all matching suppliers. If preferred is found, uses its price breaks with `lookupPriceFromBreaks` just like the explicit-supplier branch.
- **Preview panel** uses a dedicated API route that returns both price breaks and addons to avoid bloating the existing `supplier-processes` endpoint. Fetches only when `supplierProcessId` is set.
- **Known scope trade-offs**: I did not update `get-method/functions/lib/methods.ts` — it's a bundled JS artifact not consumed by `get-method/index.ts`, which imports from the top-level `functions/lib/methods.ts`. If that artifact is ever referenced, it needs a rebuild, not a manual patch.
