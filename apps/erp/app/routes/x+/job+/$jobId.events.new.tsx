import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  getJob,
  getJobOperations,
  isJobLocked,
  productionEventValidator,
  upsertProductionEvent
} from "~/modules/production";
import { ProductionEventForm } from "~/modules/production/ui/Jobs";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId } = params;
  if (!jobId) throw notFound("jobId not found");

  const [job, jobOperations] = await Promise.all([
    getJob(client, jobId),
    getJobOperations(client, jobId)
  ]);

  const operationOptions =
    jobOperations.data?.map((operation) => ({
      label: operation.description ?? "",
      value: operation.id
    })) ?? [];

  const { data: dependencies } = await client
    .from("jobOperationDependency")
    .select("operationId, dependsOnId")
    .eq("jobId", jobId);

  const operationsMap = new Map(
    (jobOperations.data ?? []).map((op) => [op.id, op])
  );
  const operationWarnings: Record<string, string[]> = {};
  for (const op of jobOperations.data ?? []) {
    const warnings: string[] = [];
    const deps = (dependencies ?? []).filter((d) => d.operationId === op.id);
    for (const dep of deps) {
      const pred = operationsMap.get(dep.dependsOnId);
      if (pred && pred.status !== "Done") {
        warnings.push(
          `Previous step "${pred.description}" is not yet complete`
        );
      }
    }
    if (warnings.length > 0) {
      operationWarnings[op.id] = warnings;
    }
  }

  return {
    operationOptions,
    operationWarnings,
    jobPaused: job.data?.status === "Paused"
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId } = params;
  if (!jobId) {
    throw notFound("jobId not found");
  }

  const { client: viewClient } = await requirePermissions(request, {
    view: "production"
  });
  const job = await getJob(viewClient, jobId);
  await requireUnlocked({
    request,
    isLocked: isJobLocked(job.data?.status),
    redirectTo: path.to.job(jobId),
    message: "Cannot modify a locked job. Reopen it first."
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(productionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insert = await upsertProductionEvent(client, {
    ...d,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return data(
      {},
      await flash(
        request,
        error(insert.error, "Failed to insert production event")
      )
    );
  }

  return modal
    ? data(insert, { status: 201 })
    : redirect(
        `${path.to.jobProductionEvents(jobId)}?${getParams(request)}`,
        await flash(request, success("Production event created"))
      );
}

export default function NewProductionEventRoute() {
  const { operationOptions, operationWarnings, jobPaused } =
    useLoaderData<typeof loader>();
  const initialValues = {
    type: "Labor" as const,
    jobOperationId: "",
    startTime: new Date(new Date().setHours(8, 0, 0, 0)).toISOString(),
    employeeId: "",
    workCenterId: "",
    notes: ""
  };

  return (
    <ProductionEventForm
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
      operationWarnings={operationWarnings}
      jobPaused={jobPaused}
    />
  );
}
