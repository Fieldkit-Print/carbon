import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { recalculateTask } from "@carbon/jobs/trigger/recalculate";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import { getDefaultShelfForJob } from "~/modules/inventory";
import { getItemReplenishment } from "~/modules/items";
import {
  calculateJobPriority,
  jobValidator,
  upsertJob,
  upsertJobMethod
} from "~/modules/production";
import { JobForm } from "~/modules/production/ui/Jobs";
import { getNextSequence } from "~/modules/settings";
import type { MethodItemType } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { tasks } from "~/utils/tasks";

export const handle: Handle = {
  breadcrumb: "Jobs",
  to: path.to.jobs,
  module: "production"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
    role: "employee"
  });

  const formData = await request.formData();
  const validation = await validator(jobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let jobId = validation.data.jobId;
  const useNextSequence = !jobId;

  // Fetch manufacturing data for lead time and scrap percentage
  const [nextSequenceResult, manufacturing] = await Promise.all([
    useNextSequence
      ? getNextSequence(client, "job", companyId)
      : Promise.resolve({ data: null, error: null }),
    getItemReplenishment(client, validation.data.itemId, companyId)
  ]);

  if (useNextSequence) {
    if (nextSequenceResult.error) {
      throw redirect(
        path.to.newJob,
        await flash(
          request,
          error(nextSequenceResult.error, "Failed to get next sequence")
        )
      );
    }
    jobId = nextSequenceResult.data;
  }

  const leadTime = manufacturing.data?.leadTime ?? 7;

  if (!jobId) throw new Error("jobId is not defined");
  const { id: _id, ...d } = validation.data;

  // Calculate scrap quantity from the item's scrap percentage if not set
  const scrapPercentage = manufacturing.data?.scrapPercentage ?? 0;
  const calculatedScrapQuantity =
    scrapPercentage > 0
      ? Math.ceil(validation.data.quantity * scrapPercentage)
      : 0;
  // Use the form value if set, otherwise use calculated value
  const scrapQuantity =
    d.scrapQuantity && d.scrapQuantity > 0
      ? d.scrapQuantity
      : calculatedScrapQuantity;

  let configuration = undefined;
  if (d.configuration) {
    try {
      configuration = JSON.parse(d.configuration);
    } catch (error) {
      console.error(error);
    }
  }

  const shelfId = await getDefaultShelfForJob(
    client,
    validation.data.itemId,
    validation.data.locationId,
    companyId
  );

  // Calculate priority based on due date and deadline type
  const priority = await calculateJobPriority(client, {
    dueDate: d.dueDate ?? null,
    deadlineType: d.deadlineType,
    companyId,
    locationId: validation.data.locationId
  });

  const createJob = await upsertJob(client, {
    ...d,
    jobId,
    configuration,
    priority,
    scrapQuantity,
    shelfId: shelfId ?? undefined,
    startDate: d.dueDate
      ? parseDate(d.dueDate).subtract({ days: leadTime }).toString()
      : undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  const id = createJob.data?.id!;
  if (createJob.error || !jobId) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(createJob.error, "Failed to insert job"))
    );
  }

  const upsertMethod = await upsertJobMethod(
    getCarbonServiceRole(),
    "itemToJob",
    {
      sourceId: d.itemId,
      targetId: id,
      companyId,
      userId,
      configuration
    }
  );

  if (upsertMethod.error) {
    throw redirect(
      path.to.job(id),
      await flash(
        request,
        error(upsertMethod.error, "Failed to create job method.")
      )
    );
  }

  await tasks.trigger<typeof recalculateTask>("recalculate", {
    type: "jobRequirements",
    id,
    companyId,
    userId
  });

  throw redirect(path.to.job(id));
}

export default function JobNewRoute() {
  const { defaults } = useUser();
  const [params] = useUrlParams();
  const customerId = params.get("customerId");

  const initialValues = {
    customerId: customerId ?? "",
    deadlineType: "No Deadline" as const,
    description: "",
    dueDate: "",
    itemId: "",
    itemType: "Item" as MethodItemType,
    jobId: undefined,
    locationId: defaults?.locationId ?? "",
    quantity: 1,
    scrapQuantity: 0,
    status: "Draft" as const,
    unitOfMeasureCode: "EA"
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <JobForm initialValues={initialValues} />
    </div>
  );
}
