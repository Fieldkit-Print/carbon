/**
 * POST /api/billing/line-items
 *
 * Carbon billing endpoint for Shelf-driven billable events. Shelf POSTs one
 * row at a time as physical events happen (storage day, pick, return,
 * rental day, rental loss, consumable use). Each event becomes a `Fee`
 * line on the customer's open monthly Draft invoice.
 *
 * Behaviour:
 *   1. Auth via `requirePermissions({ create: "invoicing" })` (carbon-key).
 *   2. Validate request body (zod).
 *   3. Idempotency: if a `salesInvoiceLine` already exists with
 *      `customFields->>'shelfBillableEventId' = idempotencyKey`, return its
 *      id and do nothing else (safe retry).
 *   4. Resolve unit price:
 *        - if `amountCents` was sent, use it (Shelf computed locally)
 *        - else call `resolve_warehouse_price()` against `warehousePrice`
 *        - else 0 with a flag in `externalNotes` ("price-unresolved")
 *   5. Find-or-create a Draft `salesInvoice` for
 *      (companyId, carbonCustomerId, calendar month of occurredAt). The
 *      month bucket lives in `salesInvoice.externalId->>'shelfBillingMonth'`
 *      (format `YYYY-MM`).
 *   6. Insert a new `salesInvoiceLine` with `invoiceLineType = 'Fee'`,
 *      stamping the idempotency key into `customFields`.
 *   7. Return `{ data: { invoiceLineId } }`.
 *
 * @see {@link file://./../../../../packages/database/supabase/migrations/20260514000000_warehouse-pricing.sql}
 *   warehousePrice table + resolve_warehouse_price()
 */

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

/**
 * Mirror of Shelf's `BillableEventKind`. Source of truth lives in
 * `apps/webapp/app/modules/billing/types.ts` over there; keep these in sync.
 */
const BILLABLE_KINDS = [
  "STORAGE",
  "PICK",
  "RETURN",
  "RENTAL_USE",
  "RENTAL_LOSS",
  "CONSUMABLE_USE"
] as const;
type BillableEventKind = (typeof BILLABLE_KINDS)[number];

/** Map of Shelf billable event kinds → Carbon `pricingKind`. */
const KIND_TO_PRICING_KIND: Record<BillableEventKind, string> = {
  STORAGE: "storage_day",
  PICK: "pick_fee",
  RETURN: "return_fee",
  RENTAL_USE: "rental_day",
  RENTAL_LOSS: "rental_loss",
  CONSUMABLE_USE: "consumable_use"
};

const HUMAN_KIND_DESCRIPTION: Record<BillableEventKind, string> = {
  STORAGE: "Storage",
  PICK: "Pick fee",
  RETURN: "Return fee",
  RENTAL_USE: "Rental use",
  RENTAL_LOSS: "Rental loss",
  CONSUMABLE_USE: "Consumable use"
};

const bodySchema = z.object({
  companyId: z.string().min(1),
  carbonCustomerId: z.string().min(1),
  kind: z.enum(BILLABLE_KINDS),
  quantity: z.number().positive(),
  /** Optional explicit price in cents. Null/absent → resolve via warehousePrice. */
  amountCents: z.number().int().nonnegative().nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  carbonPartId: z.string().nullable().optional(),
  /** Reserved for future — Shelf currently sends only carbon ids, but the
   *  warehousePrice resolver also accepts a locationId dimension. */
  locationId: z.string().nullable().optional(),
  occurredAt: z.string().datetime(),
  periodStart: z.string().datetime().nullable().optional(),
  periodEnd: z.string().datetime().nullable().optional(),
  /** Shelf's deterministic event id. Used for idempotency. */
  idempotencyKey: z.string().min(1),
  notes: z.string().optional()
});

type Body = z.infer<typeof bodySchema>;

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const parseResult = bodySchema.safeParse(await request.json());
  if (!parseResult.success) {
    return data(
      { success: false, error: parseResult.error.flatten() },
      { status: 400 }
    );
  }
  const body = parseResult.data;

  // Auth scope is per-company; the API key is already scoped, but the
  // body also carries companyId — they must match.
  if (body.companyId !== companyId) {
    return data(
      {
        success: false,
        error: "Body companyId does not match the API key's company scope."
      },
      { status: 403 }
    );
  }

  // Step 1: idempotency check.
  const existing = await client
    .from("salesInvoiceLine")
    .select("id")
    .eq("companyId", companyId)
    .eq("customFields->>shelfBillableEventId", body.idempotencyKey)
    .maybeSingle();

  if (existing.error) {
    return data(
      { success: false, error: existing.error.message },
      { status: 500 }
    );
  }
  if (existing.data) {
    return data(
      { success: true, data: { invoiceLineId: existing.data.id } },
      { status: 200 }
    );
  }

  // Step 2: resolve unit price.
  const occurredAt = new Date(body.occurredAt);
  const priceResolution = await resolveUnitPrice({
    client,
    body,
    companyId,
    occurredAt
  });

  // Step 3: find-or-create the monthly Draft invoice.
  const invoice = await findOrCreateMonthlyDraftInvoice({
    client,
    companyId,
    customerId: body.carbonCustomerId,
    occurredAt,
    createdBy: userId,
    currencyCode: priceResolution.currencyCode
  });
  if ("error" in invoice && invoice.error) {
    return data({ success: false, error: invoice.error }, { status: 500 });
  }
  const invoiceRow = invoice.invoice;

  // Step 4: insert the line.
  // The human-readable description lands in `externalNotes` since Fee
  // lines don't have a description column; this is what shows on the
  // customer-facing invoice PDF.
  const description = HUMAN_KIND_DESCRIPTION[body.kind];
  const externalNotes: Record<string, unknown> = { description };
  if (body.notes) externalNotes.note = body.notes;

  const lineInsert = await client
    .from("salesInvoiceLine")
    .insert([
      {
        invoiceId: invoiceRow.id,
        companyId,
        invoiceLineType: "Fee",
        // Item linkage (optional). Fee lines don't require an item, but
        // we tag carbonPartId when supplied so reports can group by SKU.
        itemId: body.carbonPartId ?? null,
        quantity: body.quantity,
        unitPrice: priceResolution.amount, // NUMERIC, dollars
        exchangeRate: 1,
        taxPercent: 0,
        unitOfMeasureCode: "EA",
        // Stamp the idempotency key + price-resolution metadata into
        // customFields for retries + audit.
        customFields: {
          shelfBillableEventId: body.idempotencyKey,
          shelfBillableEventKind: body.kind,
          shelfBillableEventOccurredAt: body.occurredAt,
          shelfBillableEventPeriodStart: body.periodStart ?? null,
          shelfBillableEventPeriodEnd: body.periodEnd ?? null,
          shelfPriceResolution: priceResolution.source,
          shelfWarehousePriceId: priceResolution.priceId ?? null
        },
        externalNotes,
        createdBy: userId
      }
    ])
    .select("id")
    .single();

  if (lineInsert.error) {
    return data(
      { success: false, error: lineInsert.error.message },
      { status: 500 }
    );
  }

  return data(
    {
      success: true,
      data: {
        invoiceLineId: lineInsert.data.id,
        invoiceId: invoiceRow.id,
        priceResolution: priceResolution.source
      }
    },
    { status: 200 }
  );
}

// =============================================================================
// Helpers
// =============================================================================

type PriceResolution = {
  amount: number;
  currencyCode: string;
  priceId: string | null;
  /** Where the price came from: "explicit" (sent by Shelf), "resolver"
   *  (matched a warehousePrice row), or "unresolved" (no match — invoiced
   *  at 0 with a flag for staff to fix). */
  source: "explicit" | "resolver" | "unresolved";
};

async function resolveUnitPrice(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  body: Body;
  companyId: string;
  occurredAt: Date;
}): Promise<PriceResolution> {
  const { client, body, companyId, occurredAt } = args;

  // If Shelf sent an explicit amount, trust it. Convert cents → dollars.
  if (body.amountCents !== null && body.amountCents !== undefined) {
    return {
      amount: body.amountCents / 100,
      currencyCode: body.currencyCode ?? "USD",
      priceId: null,
      source: "explicit"
    };
  }

  // Otherwise ask the resolver.
  const resolved = await client.rpc("resolve_warehouse_price", {
    p_company_id: companyId,
    p_pricing_kind: KIND_TO_PRICING_KIND[body.kind],
    p_customer_id: body.carbonCustomerId,
    p_location_id: body.locationId ?? null,
    p_item_id: body.carbonPartId ?? null,
    p_at: occurredAt.toISOString()
  });

  if (resolved.error || !resolved.data || resolved.data.length === 0) {
    return {
      amount: 0,
      currencyCode: body.currencyCode ?? "USD",
      priceId: null,
      source: "unresolved"
    };
  }
  const row = resolved.data[0];
  return {
    amount: Number(row.amount),
    currencyCode: row.currencyCode,
    priceId: row.priceId,
    source: "resolver"
  };
}

async function findOrCreateMonthlyDraftInvoice(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  companyId: string;
  customerId: string;
  occurredAt: Date;
  createdBy: string;
  currencyCode: string;
}): Promise<
  | { invoice: { id: string; invoiceId: string }; error?: undefined }
  | { invoice?: undefined; error: string }
> {
  const { client, companyId, customerId, occurredAt, createdBy, currencyCode } =
    args;

  // YYYY-MM bucket.
  const monthKey = `${occurredAt.getUTCFullYear()}-${String(
    occurredAt.getUTCMonth() + 1
  ).padStart(2, "0")}`;

  // Look for an existing Draft invoice with this month tag.
  const lookup = await client
    .from("salesInvoice")
    .select("id, invoiceId")
    .eq("companyId", companyId)
    .eq("customerId", customerId)
    .eq("status", "Draft")
    .eq("externalId->>shelfBillingMonth", monthKey)
    .limit(1)
    .maybeSingle();

  if (lookup.error) return { error: lookup.error.message };
  if (lookup.data) return { invoice: lookup.data };

  // No invoice yet — create one. postingDate = first day of the month so
  // staff can scan the invoice list and see "May storage" etc.
  const postingDate = new Date(
    Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), 1)
  )
    .toISOString()
    .slice(0, 10);

  // Generate a human-readable invoiceId. Carbon's convention has its own
  // sequence service, but for Shelf-driven invoices we tag with a stable
  // prefix so they're easy to find. If staff later need a "real" invoiceId
  // they can edit; this is just the human-facing label.
  const invoiceId = `SHELF-${monthKey}-${customerId.slice(0, 8)}`;

  const insert = await client
    .from("salesInvoice")
    .insert([
      {
        companyId,
        customerId,
        invoiceCustomerId: customerId,
        invoiceId,
        status: "Draft",
        currencyCode,
        postingDate,
        dateIssued: postingDate,
        externalId: { shelfBillingMonth: monthKey },
        createdBy,
        exchangeRate: 1
      }
    ])
    .select("id, invoiceId")
    .single();

  if (insert.error) return { error: insert.error.message };
  return { invoice: insert.data };
}
