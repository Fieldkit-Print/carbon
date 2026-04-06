import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuFileUp,
  LuPencil,
  LuTrash,
  LuTrash2
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import type { z } from "zod";
import { SupplierAvatar } from "~/components";
import {
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  Select,
  StandardFactor,
  Submit
} from "~/components/Form";
import { useSupplierProcesses } from "~/components/Form/SupplierProcess";
import WorkCenters from "~/components/Form/WorkCenters";
import { usePermissions, useUser } from "~/hooks";
import { SupplierProcessForm } from "~/modules/purchasing/ui/Supplier";

import { processValidator } from "~/modules/resources";
import { processTypes } from "~/modules/shared";
import { path } from "~/utils/path";

type ProcessFormProps = {
  initialValues: z.infer<typeof processValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const ProcessForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: ProcessFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created process`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create process: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  const [processType, setProcessType] = useState(initialValues.processType);

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={processValidator}
            method="post"
            action={
              isEditing
                ? path.to.process(initialValues.id!)
                : path.to.newProcess
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Process
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Process Name" />
                <Select
                  name="processType"
                  label="Process Type"
                  options={processTypes.map((pt) => ({
                    value: pt,
                    label: pt
                  }))}
                  onChange={(newValue) => {
                    setProcessType(
                      newValue?.value as (typeof processTypes)[number]
                    );
                  }}
                />
                {processType !== "Outside" && (
                  <>
                    <StandardFactor
                      name="defaultStandardFactor"
                      label="Default Unit"
                      value={initialValues.defaultStandardFactor}
                    />
                    <WorkCenters name="workCenters" label="Work Centers" />
                  </>
                )}
                {processType !== "Inside" && (
                  <SupplierProcesses processId={initialValues.id} />
                )}
                <Boolean
                  name="completeAllOnScan"
                  label=""
                  description="Complete all quantities on barcode scan"
                />
                <ProcessPlanUpload
                  initialPath={initialValues.processPlanPath}
                />
                <CustomFormFields table="process" />
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

export default ProcessForm;

function SupplierProcesses({ processId }: { processId?: string }) {
  const permissions = usePermissions();
  const processes = useSupplierProcesses({ processId });
  const navigate = useNavigate();
  const isEditing = processId !== undefined;
  const newSupplierProcessModal = useDisclosure();

  return (
    <>
      <div className="flex flex-col gap-2 w-full">
        {processes.length > 0 && (
          <>
            <label className="text-muted-foreground text-xs">Suppliers</label>
            {processes.map((sp) => (
              <HStack
                key={sp.id}
                className="w-full justify-between rounded-md border border-border p-2 text-sm"
              >
                <SupplierAvatar supplierId={sp.supplierId} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Edit supplier process"
                      icon={<LuEllipsisVertical />}
                      size="md"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() =>
                        navigate(
                          path.to.supplierProcess(sp.supplierId!, sp.id!)
                        )
                      }
                      disabled={!permissions.can("update", "purchasing")}
                    >
                      <DropdownMenuIcon icon={<LuPencil />} />
                      Edit Process
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        navigate(
                          path.to.deleteSupplierProcess(sp.supplierId!, sp.id!)
                        )
                      }
                      disabled={!permissions.can("delete", "purchasing")}
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete Process
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </HStack>
            ))}
          </>
        )}
        <Button
          isDisabled={!isEditing}
          leftIcon={<LuCirclePlus />}
          variant="secondary"
          onClick={newSupplierProcessModal.onOpen}
        >
          Add Supplier
        </Button>
      </div>
      {newSupplierProcessModal.isOpen && processId && (
        <SupplierProcessForm
          type="modal"
          onClose={() => {
            newSupplierProcessModal.onClose();
          }}
          initialValues={{
            processId: processId,
            supplierId: "",
            minimumCost: 0,
            leadTime: 0
          }}
        />
      )}
    </>
  );
}

function ProcessPlanUpload({ initialPath }: { initialPath?: string }) {
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
}
