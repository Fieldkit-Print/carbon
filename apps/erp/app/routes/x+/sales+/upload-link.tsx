import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertExternalLink } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const entityId = formData.get("entityId") as string;
  const customerId = formData.get("customerId") as string | null;

  if (!entityId) {
    return data({ error: "Missing entity ID" }, { status: 400 });
  }

  const externalLink = await upsertExternalLink(client, {
    documentType: "ClientUpload",
    documentId: entityId,
    customerId: customerId || undefined,
    companyId
  });

  if (externalLink.error) {
    return data({ error: "Failed to create upload link" }, { status: 500 });
  }

  return data({ externalLinkId: externalLink.data.id });
}
