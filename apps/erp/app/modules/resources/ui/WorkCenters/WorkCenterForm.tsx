import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuFileUp, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  // Ability,
  CustomFormFields,
  Hidden,
  Input,
  Location,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Number,
  Processes,
  StandardFactor,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { workCenterValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type WorkCenterFormProps = {
  initialValues: z.infer<typeof workCenterValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  showProcesses?: boolean;
  onClose: () => void;
};

const WorkCenterForm = ({
  initialValues,
  open = true,
  type = "drawer",
  showProcesses = true,
  onClose
}: WorkCenterFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created work center`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create work center: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={workCenterValidator}
            method="post"
            action={
              isEditing
                ? path.to.workCenter(initialValues.id!)
                : path.to.newWorkCenter
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Work Center
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                {showProcesses && (
                  <Processes name="processes" label="Processes" />
                )}
                <TextArea name="description" label="Description" />
                <Location name="locationId" label="Location" />

                <Number
                  name="laborRate"
                  label="Labor Rate (Hourly)"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                />
                <Number
                  name="machineRate"
                  label="Machine Rate (Hourly)"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                />
                <Number
                  name="overheadRate"
                  label="Overhead Rate (Hourly)"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                />

                <StandardFactor
                  name="defaultStandardFactor"
                  label="Default Unit"
                  value={initialValues.defaultStandardFactor}
                />
                <ProcessPlanUpload
                  initialPath={initialValues.processPlanPath}
                />
                {/* <Ability
                  name="requiredAbilityId"
                  label="Required Ability"
                  isClearable
                /> */}
                <CustomFormFields table="workCenter" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

const ProcessPlanUpload = ({ initialPath }: { initialPath?: string }) => {
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();
  const [storagePath, setStoragePath] = useState(initialPath ?? "");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileName = storagePath ? storagePath.split("/").pop() : null;

  const handleUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !carbon) return;

      setUploading(true);
      const uploadPath = `${companyId}/process-plans/${file.name}`;

      const { error } = await carbon.storage
        .from("private")
        .upload(uploadPath, file, { upsert: true });

      if (error) {
        toast.error(`Failed to upload process plan: ${error.message}`);
        setUploading(false);
        return;
      }

      setStoragePath(uploadPath);
      setUploading(false);
      toast.success(`Uploaded ${file.name}`);
    },
    [carbon, companyId]
  );

  const handleRemove = useCallback(() => {
    setStoragePath("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return (
    <div>
      <input type="hidden" name="processPlanPath" value={storagePath} />
      <label className="text-sm font-medium mb-1 block">PDF Process Plan</label>
      {fileName ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <LuFileUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="truncate flex-1">{fileName}</span>
          <button
            type="button"
            onClick={handleRemove}
            className="text-muted-foreground hover:text-destructive flex-shrink-0"
          >
            <LuTrash2 className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".kfpx"
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => fileInputRef.current?.click()}
            isDisabled={uploading}
          >
            <LuFileUp className="h-4 w-4 mr-2" />
            {uploading ? "Uploading..." : "Upload .kfpx"}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        Process plan for auto-generating sub-production files
      </p>
    </div>
  );
};

export default WorkCenterForm;
