import { assertIsPost, ERP_URL, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { notifyEntityStatusChanged } from "@carbon/ee/notifications";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getQuote, quoteStatusType, updateQuoteStatus } from "~/modules/sales";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { quoteId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status") as (typeof quoteStatusType)[number];

  if (!status || !quoteStatusType.includes(status)) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updateQuoteStatus(client, {
    id,
    status,
    assignee: ["Closed"].includes(status) ? null : undefined,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.quote(id),
      await flash(request, error(update.error, "Failed to update quote status"))
    );
  }

  try {
    const [quote, integrations] = await Promise.all([
      getQuote(client, id),
      getCompanyIntegrations(client, companyId)
    ]);
    if (quote.data) {
      const { data: customer } = await client
        .from("customer")
        .select("name")
        .eq("id", quote.data.customerId ?? "")
        .maybeSingle();
      await notifyEntityStatusChanged({ client }, integrations, {
        companyId,
        userId,
        carbonUrl: `${ERP_URL}${path.to.quote(id)}`,
        entity: {
          entityType: "quote",
          id,
          status,
          readableId: quote.data.quoteId ?? "",
          customerName: customer?.name ?? ""
        }
      });
    }
  } catch (err) {
    console.error("Failed to notify quote status change:", err);
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(request, success("Updated quote status"))
  );
}
