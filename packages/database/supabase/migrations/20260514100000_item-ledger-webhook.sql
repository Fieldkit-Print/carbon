-- =============================================================================
-- Expose itemLedger as a webhook-subscribable table.
--
-- The Shelf integration (Fieldkit fork) needs to react when a serial unit
-- lands in inventory so it can mint one Shelf Asset per physical unit.
-- The cleanest signal for "this physical thing now exists" is the first
-- positive-quantity itemLedger row referencing a trackedEntity — that's
-- the receipt or positive-adjustment event.
--
-- Two pieces are needed for Carbon's existing webhook framework to fire
-- on itemLedger:
--
--   1. A row in `webhookTable` makes the table appear in the
--      Settings → Webhooks UI dropdown.
--   2. An AFTER INSERT trigger on the table calling `webhook_insert()`
--      (the same function used by customer / item / etc.) actually
--      delivers the payload.
--
-- We only wire INSERT — ledger rows are append-only in Carbon's model so
-- update / delete triggers would be no-ops.
-- =============================================================================

INSERT INTO "webhookTable" ("table", module, name)
VALUES ('itemLedger', 'Inventory', 'Item Ledger')
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS webhook_insert_itemLedger ON public."itemLedger";
CREATE TRIGGER webhook_insert_itemLedger
AFTER INSERT ON public."itemLedger"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();
