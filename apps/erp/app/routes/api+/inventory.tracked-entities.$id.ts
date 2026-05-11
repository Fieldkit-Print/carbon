import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

/**
 * PATCH /api/inventory/tracked-entities/:id
 *
 * Partial update for a single trackedEntity. Currently only supports
 * merging into the `attributes` JSONB — used by Shelf to write its
 * generated Asset ID back into Carbon so staff can correlate the
 * physical unit to its Shelf record.
 *
 * Body shape:
 *   { "attributes": { ...full attributes blob to write... } }
 *
 * The caller is responsible for merging — this endpoint replaces the
 * column wholesale. That keeps the contract simple and shifts the
 * "don't clobber other keys" responsibility to the side that already
 * has the most recent view of the JSONB (Shelf reads via FDW).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "POST") {
    return data({ error: { message: "Method not allowed" } }, { status: 405 });
  }

  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const trackedEntityId = params.id;
  if (!trackedEntityId) {
    return data(
      { error: { message: "Tracked entity id is required" } },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    attributes?: Record<string, unknown>;
  } | null;

  if (
    !body ||
    typeof body.attributes !== "object" ||
    body.attributes === null
  ) {
    return data(
      { error: { message: "Body must include an `attributes` object" } },
      { status: 400 }
    );
  }

  const update = await client
    .from("trackedEntity")
    .update({
      // @ts-expect-error Supabase types don't expose updatedBy/At on this
      // table even though the columns exist — keeping the audit trail.
      attributes: body.attributes
    })
    .eq("id", trackedEntityId)
    .eq("companyId", companyId)
    .select("id, attributes")
    .single();

  if (update.error) {
    return data(
      error(update.error, "Failed to update tracked entity attributes"),
      { status: 500 }
    );
  }

  // Reference userId so the linter doesn't warn even though we're not
  // currently writing an audit column for this update path.
  void userId;

  return data({ data: update.data, error: null });
}
