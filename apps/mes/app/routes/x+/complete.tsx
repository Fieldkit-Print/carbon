import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { nonScrapQuantityValidator } from "~/services/models";
import { insertProductionQuantity } from "~/services/operations.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();

  if (validation.data.trackingType === "Serial") {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationSerialComplete",
        ...validation.data,
        companyId,
        userId
      },
      region: FunctionRegion.UsWest2
    });

    const trackedEntityId = response.data?.newTrackedEntityId;

    if (trackedEntityId) {
      return redirect(
        `${path.to.operation(
          validation.data.jobOperationId
        )}?trackedEntityId=${trackedEntityId}`
      );
    }

    return redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  } else if (validation.data.trackingType === "Batch") {
    const serviceRole = await getCarbonServiceRole();
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationBatchComplete",
        ...validation.data,
        companyId,
        userId
      },
      region: FunctionRegion.UsWest2
    });

    if (response.error) {
      return data(
        {},
        await flash(request, {
          ...error(response.error, "Failed to complete job operation"),
          flash: "error"
        })
      );
    }

    return redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  } else {
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    const { trackedEntityId, trackingType, ...d } = validation.data;
    const insertProduction = await insertProductionQuantity(serviceRole, {
      ...d,
      companyId,
      createdBy: userId
    });

    if (insertProduction.error) {
      return data(
        {},
        await flash(request, {
          ...error(
            insertProduction.error,
            "Failed to record production quantity"
          ),
          flash: "error"
        })
      );
    }

    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        id: validation.data.jobOperationId,
        type: "jobOperation",
        quantity: validation.data.quantity,
        companyId,
        userId
      },
      region: FunctionRegion.UsWest2
    });

    if (issue.error) {
      throw data(
        {},
        await flash(request, {
          ...error(issue.error, "Failed to issue materials"),
          flash: "error"
        })
      );
    }

    return data(
      {},
      await flash(request, {
        ...success("Successfully completed part"),
        flash: "success"
      })
    );
  }
}
