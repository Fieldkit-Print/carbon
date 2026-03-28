import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { syncIssueFromLinearSchema } from "@carbon/jobs/trigger/linear";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { tasks } from "~/utils/tasks";
import { getIntegration } from "../../modules/settings";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return {
    success: true
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;

  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  const serviceRole = getCarbonServiceRole();
  const integration = await getIntegration(serviceRole, "linear", companyId);

  if (integration.error) {
    console.error(
      "Linear webhook: integration query failed",
      integration.error
    );
    return data(
      { success: false, error: "Integration query failed" },
      { status: 400 }
    );
  }

  if (!integration.data) {
    return data(
      { success: false, error: "Integration not configured" },
      { status: 400 }
    );
  }

  if (!integration.data.active) {
    return data(
      { success: false, error: "Integration not active" },
      { status: 400 }
    );
  }

  const body = await request.json();

  const parsed = syncIssueFromLinearSchema.safeParse({
    companyId,
    event: body
  });

  if (!parsed.success) {
    return data(
      { success: false, error: parsed.error.format() },
      { status: 400 }
    );
  }

  try {
    await tasks.trigger("sync-issue-from-linear", parsed.data);
    return { success: true };
  } catch (err) {
    console.error("Linear webhook: failed to trigger task", err);
    return data({ success: false }, { status: 500 });
  }
}
