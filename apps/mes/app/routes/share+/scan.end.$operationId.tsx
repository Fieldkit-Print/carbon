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
import { FunctionRegion } from "@supabase/supabase-js";
import { useState } from "react";
import { FaCheck } from "react-icons/fa6";
import { LuCircleAlert } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import {
  getTrackedEntitiesByMakeMethodId,
  insertProductionQuantity
} from "~/services/operations.service";

enum ScanState {
  Valid,
  AlreadyClosed,
  NotFound
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { operationId } = params;
  if (!operationId) return { state: ScanState.NotFound, data: null };

  const serviceRole = getCarbonServiceRole();

  const jobOperation = await serviceRole
    .from("jobOperation")
    .select(
      "id, status, companyId, jobId, operationQuantity, jobMakeMethodId, job(jobId), ...process(completeAllOnScan)"
    )
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

  return {
    state: ScanState.Valid,
    data: {
      operationId,
      jobName: (jobOperation.data.job as any)?.jobId ?? "Job",
      completeAll: jobOperation.data.completeAllOnScan ?? false
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

  if (!pin || pin.length !== 4) {
    return data({ success: false, message: "Please enter a 4-digit PIN" }, 400);
  }

  const serviceRole = getCarbonServiceRole();

  const [jobOperation, productionQuantities] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select(
        "id, status, companyId, jobId, operationQuantity, jobMakeMethodId, job(jobId), ...process(completeAllOnScan)"
      )
      .eq("id", operationId)
      .maybeSingle(),
    serviceRole
      .from("productionQuantity")
      .select("quantity")
      .eq("type", "Production")
      .eq("jobOperationId", operationId)
  ]);

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
  const jobName = (jobOperation.data.job as any)?.jobId ?? "Job";

  // Calculate quantity to complete
  const currentQuantity =
    productionQuantities.data?.reduce(
      (acc, curr) => acc + (curr.quantity ?? 0),
      0
    ) ?? 0;
  const completeAll = jobOperation.data.completeAllOnScan ?? false;
  const quantityToComplete = completeAll
    ? Math.max(0, (jobOperation.data.operationQuantity ?? 0) - currentQuantity)
    : 1;

  if (quantityToComplete <= 0) {
    return data({
      success: true,
      message: "All quantities already completed",
      quantity: 0,
      jobName,
      employeeName
    });
  }

  // Determine tracking type
  let trackingType: "Serial" | "Batch" | "None" = "None";
  if (jobOperation.data.jobMakeMethodId) {
    const jobMakeMethod = await serviceRole
      .from("jobMakeMethod")
      .select("requiresSerialTracking, requiresBatchTracking")
      .eq("id", jobOperation.data.jobMakeMethodId)
      .maybeSingle();

    if (jobMakeMethod.data?.requiresSerialTracking) {
      trackingType = "Serial";
    } else if (jobMakeMethod.data?.requiresBatchTracking) {
      trackingType = "Batch";
    }
  }

  // Resolve tracked entity if needed
  let trackedEntityId: string | null = null;
  if (trackingType !== "None" && jobOperation.data.jobMakeMethodId) {
    const trackedEntities = await getTrackedEntitiesByMakeMethodId(
      serviceRole,
      jobOperation.data.jobMakeMethodId
    );
    if (trackedEntities.data && trackedEntities.data.length > 0) {
      trackedEntityId =
        trackedEntities.data[trackedEntities.data.length - 1].id;
    }
  }

  // Record the quantity
  if (trackingType === "Serial") {
    await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationSerialComplete",
        quantity: 1,
        jobOperationId: operationId,
        trackedEntityId,
        trackingType: "Serial",
        notes: "Generated by QR code",
        companyId,
        userId: employeeId
      },
      region: FunctionRegion.UsWest2
    });
  } else if (trackingType === "Batch") {
    await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationBatchComplete",
        quantity: quantityToComplete,
        jobOperationId: operationId,
        trackedEntityId,
        trackingType: "Batch",
        notes: "Generated by QR code",
        companyId,
        userId: employeeId
      },
      region: FunctionRegion.UsWest2
    });
  } else {
    await insertProductionQuantity(serviceRole, {
      quantity: quantityToComplete,
      jobOperationId: operationId,
      notes: "Generated by QR code",
      companyId,
      createdBy: employeeId
    });

    await serviceRole.functions.invoke("issue", {
      body: {
        id: operationId,
        type: "jobOperation",
        quantity: quantityToComplete,
        companyId,
        userId: employeeId
      },
      region: FunctionRegion.UsWest2
    });
  }

  return data({
    success: true,
    message: `${quantityToComplete} qty completed`,
    quantity: quantityToComplete,
    jobName,
    employeeName
  });
}

export default function ScanEndPage() {
  const { state, data: loaderData } = useLoaderData<typeof loader>();

  if (state === ScanState.NotFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <LuCircleAlert className="h-12 w-12 text-muted-foreground" />
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
    const successResult = result as {
      quantity: number;
      jobName: string;
      employeeName: string;
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-6 p-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <FaCheck className="h-6 w-6" />
            </div>
            <VStack spacing={1} className="items-center">
              <Heading size="h3">
                {successResult.quantity > 0
                  ? `${successResult.quantity} Qty Completed`
                  : "Already Complete"}
              </Heading>
              <p className="text-muted-foreground text-center">
                Job <strong>{successResult.jobName}</strong>
              </p>
              <p className="text-muted-foreground text-sm">
                By {successResult.employeeName}
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
            <Badge variant="blue" className="text-sm">
              {initialData.completeAll ? "Complete All" : "Complete 1 Qty"}
            </Badge>
          </VStack>

          <VStack spacing={2} className="items-center w-full">
            <p className="text-muted-foreground text-sm text-center">
              Enter your 4-digit PIN
            </p>
            <fetcher.Form method="post">
              <input type="hidden" name="pin" value={pin} />
              <VStack spacing={4} className="items-center">
                <InputOTP
                  maxLength={4}
                  value={pin}
                  onChange={(value) => {
                    setPin(value);
                  }}
                  onComplete={() => {
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
