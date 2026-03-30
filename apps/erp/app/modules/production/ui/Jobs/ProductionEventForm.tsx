import { TextArea, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import type { CalendarDateTime } from "@internationalized/date";
import {
  getLocalTimeZone,
  parseAbsolute,
  toCalendarDateTime
} from "@internationalized/date";
import { useState } from "react";
import { LuAlertTriangle } from "react-icons/lu";
import { useNavigate } from "react-router";
import type { z } from "zod";
import {
  DateTimePicker,
  Employee,
  Hidden,
  Select,
  Submit,
  WorkCenter
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { productionEventValidator } from "../../production.models";

type ProductionEventFormProps = {
  initialValues: z.infer<typeof productionEventValidator>;
  operationOptions: {
    label: string;
    value: string;
    helperText?: string;
  }[];
  operationWarnings?: Record<string, string[]>;
  jobPaused?: boolean;
};

const ProductionEventForm = ({
  initialValues,
  operationOptions,
  operationWarnings,
  jobPaused
}: ProductionEventFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const [selectedOperationId, setSelectedOperationId] = useState(
    initialValues.jobOperationId
  );
  const [startTime, setStartTime] = useState(
    toCalendarDateTime(
      parseAbsolute(initialValues.startTime, getLocalTimeZone())
    )
  );
  const [endTime, setEndTime] = useState<CalendarDateTime | undefined>(
    initialValues.endTime
      ? toCalendarDateTime(
          parseAbsolute(initialValues.endTime, getLocalTimeZone())
        )
      : undefined
  );
  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  const warnings: string[] = [];
  if (jobPaused) warnings.push("This job is currently paused");
  if (selectedOperationId && operationWarnings?.[selectedOperationId]) {
    warnings.push(...operationWarnings[selectedOperationId]);
  }
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={productionEventValidator}
          method="post"
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit Production Event" : "Create Production Event"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />

            <VStack spacing={4}>
              {warnings.length > 0 && (
                <Alert className="border-amber-500/30 bg-gradient-to-tr from-amber-500/10 via-card to-card text-amber-600 [&>svg]:text-amber-600 dark:text-amber-400 dark:[&>svg]:text-amber-400">
                  <LuAlertTriangle className="h-4 w-4" />
                  <AlertTitle>Warning</AlertTitle>
                  <AlertDescription>
                    {warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              <Select
                name="jobOperationId"
                label="Operation"
                options={operationOptions ?? []}
                onChange={(value) => setSelectedOperationId(value?.value ?? "")}
              />
              <Employee name="employeeId" label="Employee" />
              <WorkCenter
                name="workCenterId"
                label="Work Center"
                processId={initialValues.jobOperationId}
              />
              <Select
                name="type"
                label="Event Type"
                options={[
                  { label: "Labor", value: "Labor" },
                  { label: "Machine", value: "Machine" },
                  { label: "Setup", value: "Setup" }
                ]}
              />
              <DateTimePicker
                name="startTime"
                label="Start Time"
                maxValue={endTime}
                onChange={setStartTime}
              />
              <DateTimePicker
                name="endTime"
                label="End Time"
                minValue={startTime}
                onChange={setEndTime}
              />
              <TextArea name="notes" label="Notes" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ProductionEventForm;
