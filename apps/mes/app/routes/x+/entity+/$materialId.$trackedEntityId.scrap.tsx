import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getTrackedEntity } from "~/services/operations.service";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { trackedEntityId, materialId } = params;
  if (!materialId) throw new Error("Could not find materialId");
  if (!trackedEntityId) throw new Error("Could not find trackedEntityId");

  // Get optional parentId from query params
  const url = new URL(request.url);
  const parentTrackedEntityId = url.searchParams.get("parentId") || undefined;

  const trackedEntity = await getTrackedEntity(client, trackedEntityId);
  if (trackedEntity.error) {
    return data(
      { success: false, message: "Failed to get tracked entity" },
      { status: 400 }
    );
  }

  const serviceRole = await getCarbonServiceRole();
  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      trackedEntityId,
      materialId,
      parentTrackedEntityId,
      type: "scrapTrackedEntity",
      companyId,
      userId
    },
    region: FunctionRegion.UsWest2
  });

  if (issue.error) {
    return data(
      { success: false, message: "Failed to scrape entity" },
      { status: 400 }
    );
  }

  return { success: true, message: "Entity scraped successfully" };
}
