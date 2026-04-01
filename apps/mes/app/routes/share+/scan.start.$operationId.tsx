import { hashPin } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Heading,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  VStack
} from "@carbon/react";
import { useState } from "react";
import { FaPause, FaPlay } from "react-icons/fa6";
import { LuAlertCircle } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { toggleProductionEvent } from "~/services/operations.service";

enum ScanState {
  Valid,
  AlreadyClosed,
  NotFound
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { operationId } = params;
  if (!operationId) return { state: ScanState.NotFound, data: null };

  const url = new URL(request.url);
  const type = (url.searchParams.get("type") ?? "Labor") as
    | "Setup"
    | "Labor"
    | "Machine";
  const validTypes = ["Setup", "Labor", "Machine"];
  const resolvedType = validTypes.includes(type) ? type : "Labor";

  const serviceRole = getCarbonServiceRole();

  const jobOperation = await serviceRole
    .from("jobOperation")
    .select("id, status, workCenterId, companyId, jobId, job(jobId)")
    .eq("id", operationId)
    .maybeSingle();

  if (jobOperation.error || !jobOperation.data) {
    return { state: ScanState.NotFound, data: null };
  }

  if (
    jobOperation.data.status === "Done" ||
    jobOperation.data.status === "Canceled"
  ) {
    return {
      state: ScanState.AlreadyClosed,
      data: {
        jobName: (jobOperation.data.job as any)?.jobId ?? "Job"
      }
    };
  }

  // Check for active event of this type to determine intent
  const { data: activeEvents } = await serviceRole
    .from("productionEvent")
    .select("id, type")
    .eq("jobOperationId", operationId)
    .eq("type", resolvedType)
    .is("endTime", null)
    .limit(1);

  const intent = activeEvents && activeEvents.length > 0 ? "pause" : "start";

  return {
    state: ScanState.Valid,
    data: {
      operationId,
      type: resolvedType,
      intent,
      jobName: (jobOperation.data.job as any)?.jobId ?? "Job"
    }
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { operationId } = params;
  if (!operationId) {
    return data({ success: false, message: "Operation not found" }, 400);
  }

  const formData = await request.formData();
  const pin = formData.get("pin") as string;
  const type = formData.get("type") as "Setup" | "Labor" | "Machine";

  if (!pin || pin.length !== 4) {
    return data({ success: false, message: "Please enter a 4-digit PIN" }, 400);
  }

  if (!["Setup", "Labor", "Machine"].includes(type)) {
    return data({ success: false, message: "Invalid event type" }, 400);
  }

  const serviceRole = getCarbonServiceRole();

  // Look up the job operation to get companyId and workCenterId
  const jobOperation = await serviceRole
    .from("jobOperation")
    .select("id, status, workCenterId, companyId, jobId, job(jobId)")
    .eq("id", operationId)
    .maybeSingle();

  if (jobOperation.error || !jobOperation.data) {
    return data({ success: false, message: "Operation not found" }, 404);
  }

  if (
    jobOperation.data.status === "Done" ||
    jobOperation.data.status === "Canceled"
  ) {
    return data(
      { success: false, message: "This operation is already complete" },
      400
    );
  }

  const { companyId } = jobOperation.data;

  // Validate PIN
  const pinHash = hashPin(pin, companyId);
  const employee = await serviceRole
    .from("employee")
    .select("id, ...user(firstName, lastName)")
    .eq("pinHash", pinHash)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();

  if (employee.error || !employee.data) {
    return data({ success: false, message: "Incorrect PIN" }, 401);
  }

  const employeeId = employee.data.id;
  const employeeName = [employee.data.firstName, employee.data.lastName]
    .filter(Boolean)
    .join(" ");

  // Toggle the production event
  const result = await toggleProductionEvent(serviceRole, {
    jobOperationId: operationId,
    type,
    employeeId,
    companyId,
    workCenterId: jobOperation.data.workCenterId
  });

  if (result.error) {
    return data({ success: false, message: result.error }, 500);
  }

  const jobName = (jobOperation.data.job as any)?.jobId ?? "Job";
  const actionLabel = result.action === "started" ? "started" : "paused";

  return data({
    success: true,
    message: `${type} ${actionLabel}`,
    action: result.action,
    type,
    jobName,
    employeeName
  });
}

export default function ScanStartPage() {
  const { state, data: loaderData } = useLoaderData<typeof loader>();

  if (state === ScanState.NotFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <LuAlertCircle className="h-12 w-12 text-muted-foreground" />
            <Heading size="h4">Operation Not Found</Heading>
            <p className="text-muted-foreground text-center">
              This QR code is not valid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === ScanState.AlreadyClosed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Badge variant="green" className="text-base">
              Complete
            </Badge>
            <Heading size="h4">Operation Complete</Heading>
            <p className="text-muted-foreground text-center">
              This operation for <strong>{loaderData?.jobName}</strong> is
              already complete.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <PinEntry data={loaderData!} />;
}

function PinEntry({
  data: initialData
}: {
  data: NonNullable<
    Extract<
      Awaited<ReturnType<typeof loader>>,
      { state: ScanState.Valid }
    >["data"]
  >;
}) {
  const fetcher = useFetcher<typeof action>();
  const [pin, setPin] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data;
  const isSuccess = result?.success === true;
  const isError = result?.success === false;

  if (isSuccess) {
    const actionResult = result as {
      action: "started" | "paused";
      type: string;
      jobName: string;
      employeeName: string;
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-6 p-8">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full ${
                actionResult.action === "started"
                  ? "bg-emerald-100 text-emerald-600"
                  : "bg-amber-100 text-amber-600"
              }`}
            >
              {actionResult.action === "started" ? (
                <FaPlay className="h-6 w-6" />
              ) : (
                <FaPause className="h-6 w-6" />
              )}
            </div>
            <VStack spacing={1} className="items-center">
              <Heading size="h3">
                {actionResult.type}{" "}
                {actionResult.action === "started" ? "Started" : "Paused"}
              </Heading>
              <p className="text-muted-foreground text-center">
                Job <strong>{actionResult.jobName}</strong>
              </p>
              <p className="text-muted-foreground text-sm">
                By {actionResult.employeeName}
              </p>
            </VStack>
            <Button
              variant="ghost"
              onClick={() => {
                setPin("");
                fetcher.data = undefined;
              }}
            >
              Scan Another
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-6 p-8">
          <VStack spacing={1} className="items-center">
            <Heading size="h3">{initialData.jobName}</Heading>
            <Badge
              variant={initialData.intent === "start" ? "green" : "yellow"}
              className="text-sm"
            >
              {initialData.intent === "start"
                ? `Start ${initialData.type}`
                : `Pause ${initialData.type}`}
            </Badge>
          </VStack>

          <VStack spacing={2} className="items-center w-full">
            <p className="text-muted-foreground text-sm text-center">
              Enter your 4-digit PIN
            </p>
            <fetcher.Form method="post">
              <input type="hidden" name="type" value={initialData.type} />
              <input type="hidden" name="pin" value={pin} />
              <VStack spacing={4} className="items-center">
                <InputOTP
                  maxLength={4}
                  value={pin}
                  onChange={(value) => {
                    setPin(value);
                  }}
                  onComplete={() => {
                    // Auto-submit when all 4 digits are entered
                    const form = document.querySelector(
                      "form"
                    ) as HTMLFormElement;
                    if (form) form.requestSubmit();
                  }}
                  inputMode="numeric"
                  disabled={isSubmitting}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                  </InputOTPGroup>
                </InputOTP>

                {isError && (
                  <p className="text-destructive text-sm text-center">
                    {result?.message}
                  </p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  disabled={pin.length !== 4 || isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? "Processing..." : "Confirm"}
                </Button>
              </VStack>
            </fetcher.Form>
          </VStack>
        </CardContent>
      </Card>
    </div>
  );
}
