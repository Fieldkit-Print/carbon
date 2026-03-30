import { ValidatedForm } from "@carbon/form";
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
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useNavigate } from "react-router";
import type { z } from "zod";
import {
  Employee,
  Hidden,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Number,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import ScrapReason from "~/components/Form/ScrapReason";
import { usePermissions } from "~/hooks";
import { productionQuantityValidator } from "../../production.models";

type ProductionQuantityFormProps = {
  initialValues: z.infer<typeof productionQuantityValidator>;
  operationOptions?: {
    label: string;
    value: string;
    helperText?: string;
  }[];
  operationWarnings?: Record<string, string[]>;
  jobPaused?: boolean;
};

const ProductionQuantityForm = ({
  initialValues,
  operationOptions,
  operationWarnings,
  jobPaused
}: ProductionQuantityFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const [selectedOperationId, setSelectedOperationId] = useState(
    initialValues.jobOperationId
  );
  const [type, setType] = useState<"Production" | "Scrap" | "Rework">(
    initialValues.type
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
          validator={productionQuantityValidator}
          method="post"
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing
                ? "Edit Production Quantity"
                : "Create Production Quantity"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              {warnings.length > 0 && (
                <Alert className="border-amber-500/30 bg-gradient-to-tr from-amber-500/10 via-card to-card text-amber-600 [&>svg]:text-amber-600 dark:text-amber-400 dark:[&>svg]:text-amber-400">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>Warning</AlertTitle>
                  <AlertDescription>
                    {warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              {isEditing ? (
                <Hidden name="jobOperationId" />
              ) : (
                <Select
                  name="jobOperationId"
                  label="Operation"
                  options={operationOptions ?? []}
                  onChange={(value) =>
                    setSelectedOperationId(value?.value ?? "")
                  }
                />
              )}
              <Employee name="createdBy" label="Employee" />
              <Number name="quantity" label="Quantity" />
              <Select
                name="type"
                label="Quantity Type"
                options={[
                  { label: "Production", value: "Production" },
                  { label: "Scrap", value: "Scrap" },
                  { label: "Rework", value: "Rework" }
                ]}
                onChange={(value) =>
                  setType(value?.value as "Production" | "Scrap" | "Rework")
                }
              />
              {type === "Scrap" && (
                <ScrapReason name="scrapReasonId" label="Scrap Reason" />
              )}
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

export default ProductionQuantityForm;
