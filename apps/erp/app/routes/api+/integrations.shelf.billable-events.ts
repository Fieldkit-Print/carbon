import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  insertSalesOrderLines,
  upsertSalesOrder,
} from "~/modules/sales/sales.service";

/**
 * POST /api/integrations/shelf/billable-events
 *
 * Receives one billable event from Shelf (Fieldkit) and turns it into a
 * line on the customer's open "Draft" sales order. Creates the sales
 * order on demand if no draft exists for this customer.
 *
 * Each event becomes a "Comment"-typed sales-order line — Comment type
 * skips the Item requirement so we don't need pre-created Service items
 * for every billing kind (STORAGE/PICK/RETURN/RENTAL_USE/RENTAL_LOSS/
 * CONSUMABLE_USE). The description string carries the kind + period for
 * human readability on the invoice; unitPrice + saleQuantity carry the
 * monetary value.
 *
 * Idempotency: Shelf passes an `idempotencyKey` that's stored on the
 * resulting line's customFields. We do NOT currently dedupe server-side
 * — Shelf's push worker checks BillableEvent.status before posting, so
 * the only retry path that reaches here is a successful-but-response-
 * lost scenario. If duplicate lines become a problem in production we
 * can add a customFields lookup later.
 *
 * Auth: carbon-key header → requirePermissions({ create: "sales" })
 *
 * Called by Shelf's `pushBillableEvent` in
 * `apps/webapp/app/modules/billing/carbon-push.server.ts`.
 */

const bodySchema = z.object({
  companyId: z.string().min(1),
  carbonCustomerId: z.string().min(1),
  kind: z.enum([
    "STORAGE",
    "PICK",
    "RETURN",
    "RENTAL_USE",
    "RENTAL_LOSS",
    "CONSUMABLE_USE",
  ]),
  quantity: z.number().positive(),
  amountCents: z.number().int().nullable().optional(),
  currencyCode: z.string().min(3).max(3).nullable().optional(),
  carbonPartId: z.string().nullable().optional(),
  occurredAt: z.string(), // ISO 8601
  periodStart: z.string().nullable().optional(),
  periodEnd: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
  notes: z.string().optional(),
});

/**
 * Default location id for billing-event sales orders. Pulled from env so we
 * don't hardcode a UUID. Set FIELDKIT_BILLING_LOCATION_ID to your warehouse
 * location on the Carbon side. The salesOrder validator requires a
 * locationId on every order.
 */
const FIELDKIT_BILLING_LOCATION_ID =
  process.env.FIELDKIT_BILLING_LOCATION_ID ?? "";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId: callerCompanyId, userId } = await requirePermissions(
    request,
    { create: "sales" }
  );

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return data(
      { success: false, error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  // Optional sanity check: caller's company should match the body's
  // companyId. Carbon's auth scopes to the company the carbon-key belongs
  // to, so a body claiming a different companyId is suspicious.
  if (callerCompanyId !== body.companyId) {
    return data(
      {
        success: false,
        error: `companyId mismatch: caller is in ${callerCompanyId} but body says ${body.companyId}`,
      },
      { status: 403 }
    );
  }

  if (!FIELDKIT_BILLING_LOCATION_ID) {
    return data(
      {
        success: false,
        error:
          "FIELDKIT_BILLING_LOCATION_ID is not configured on the Carbon side.",
      },
      { status: 500 }
    );
  }

  // 1. Find the customer's existing open Draft sales order, or create one.
  //    "Open" here means status = 'Draft'. Carbon staff will move it to
  //    Needs Approval / To Invoice when they're ready to bill.
  const openSo = await client
    .from("salesOrder")
    .select("id")
    .eq("customerId", body.carbonCustomerId)
    .eq("companyId", callerCompanyId)
    .eq("status", "Draft")
    // Heuristic: pick the most recently created draft. If there are
    // multiple drafts (rare), staff can manually consolidate.
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  let salesOrderId: string;
  if (openSo.data?.id) {
    salesOrderId = openSo.data.id;
  } else {
    const newSo = await upsertSalesOrder(client, {
      salesOrderId: `SHELF-${body.carbonCustomerId.slice(0, 8)}-${Date.now()}`,
      customerId: body.carbonCustomerId,
      locationId: FIELDKIT_BILLING_LOCATION_ID,
      currencyCode: body.currencyCode ?? "USD",
      status: "Draft",
      companyId: callerCompanyId,
      createdBy: userId,
      customFields: {
        shelfBillingOrder: true,
      },
    });
    if (newSo.error || !newSo.data?.id) {
      console.error("[Shelf billing] Failed to create draft SO:", newSo.error);
      return data(
        { success: false, error: "Failed to create draft sales order" },
        { status: 500 }
      );
    }
    salesOrderId = newSo.data.id;
  }

  // 2. Append the billable event as a Comment-typed line. Comment lines
  //    don't require an itemId — perfect for ad-hoc billing where each
  //    event is a distinct charge that doesn't map to a Carbon part.
  const description = renderDescription(body);
  const unitPrice = body.amountCents != null ? body.amountCents / 100 : 0;

  const lineResult = await insertSalesOrderLines(client, [
    {
      salesOrderId,
      salesOrderLineType: "Comment",
      description,
      saleQuantity: body.quantity,
      unitPrice,
      locationId: FIELDKIT_BILLING_LOCATION_ID,
      companyId: callerCompanyId,
      createdBy: userId,
      customFields: {
        shelfBillableEventKind: body.kind,
        shelfIdempotencyKey: body.idempotencyKey,
        shelfOccurredAt: body.occurredAt,
        shelfPeriodStart: body.periodStart ?? null,
        shelfPeriodEnd: body.periodEnd ?? null,
        shelfCarbonPartId: body.carbonPartId ?? null,
        shelfNotes: body.notes ?? null,
      },
    },
  ]);

  if (lineResult.error || !lineResult.data?.[0]?.id) {
    console.error(
      "[Shelf billing] Failed to insert sales order line:",
      lineResult.error
    );
    return data(
      { success: false, error: "Failed to create sales order line" },
      { status: 500 }
    );
  }

  return {
    success: true,
    data: {
      invoiceLineId: lineResult.data[0].id,
      salesOrderId,
    },
  };
}

/**
 * Build a human-readable description for the line. Carbon staff and the
 * customer (on the invoice PDF) see this text.
 */
function renderDescription(body: z.infer<typeof bodySchema>): string {
  const parts: string[] = [body.kind];
  if (body.periodStart) {
    parts.push(`for ${body.periodStart.slice(0, 10)}`);
  }
  if (body.notes) {
    parts.push(`— ${body.notes}`);
  }
  return parts.join(" ");
}
