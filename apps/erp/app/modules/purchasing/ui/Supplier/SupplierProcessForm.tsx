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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import type { z } from "zod";
import { EditableNumber, EditableText } from "~/components/Editable";
import {
  CustomFormFields,
  Hidden,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
  Number,
  Process,
  Submit,
  Supplier
} from "~/components/Form";
import Grid from "~/components/Grid";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import type { SupplierProcess } from "~/modules/purchasing";
import { supplierProcessValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type PriceBreakRow = {
  quantity: number;
  unitPrice: number;
};

type AddonRow = {
  name: string;
  amount: number;
  feeType: "flat" | "per-piece";
};

type SupplierProcessFormProps = {
  initialValues: z.infer<typeof supplierProcessValidator>;
  priceBreaks?: PriceBreakRow[];
  addons?: AddonRow[];
  type?: "drawer" | "modal";
  open?: boolean;
  onClose: () => void;
};

const SupplierProcessForm = ({
  initialValues,
  priceBreaks: initialPriceBreaks,
  addons: initialAddons,
  type = "drawer",
  open = true,
  onClose
}: SupplierProcessFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<SupplierProcess>>();
  const { supplierId } = useParams();
  const [supplier, setSupplier] = useState<string | undefined>(supplierId);
  const navigate = useNavigate();

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const [priceBreaks, setPriceBreaks] = useState<PriceBreakRow[]>(
    initialPriceBreaks ?? []
  );
  const [addons, setAddons] = useState<AddonRow[]>(initialAddons ?? []);

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      // @ts-ignore
      toast.success(`Created supplier process`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create supplier process`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            if (type === "modal") {
              onClose?.();
            } else {
              navigate(-1);
            }
          }
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={supplierProcessValidator}
            method="post"
            action={
              isEditing
                ? path.to.supplierProcess(supplier!, initialValues.id!)
                : path.to.newSupplierProcess(supplier!)
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Supplier Process
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <Hidden name="priceBreaks" value={JSON.stringify(priceBreaks)} />
              <Hidden name="addons" value={JSON.stringify(addons)} />
              {supplierId && <Hidden name="supplierId" value={supplierId} />}
              <VStack spacing={4}>
                {supplierId === undefined && (
                  <Supplier
                    name="supplierId"
                    label="Supplier"
                    onChange={(newValue) => setSupplier(newValue?.value)}
                  />
                )}
                <Process name="processId" label="Process" />
                <Number
                  name="minimumCost"
                  label="Minimum Cost"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                  minValue={0}
                />
                <Number
                  name="setupCost"
                  label="Setup Cost"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                  minValue={0}
                />
                <Number
                  name="leadTime"
                  label="Standard Lead Time"
                  minValue={0}
                />

                <PriceBreaks
                  priceBreaks={priceBreaks}
                  onChange={setPriceBreaks}
                  baseCurrency={baseCurrency}
                  isDisabled={isDisabled}
                />

                <Addons
                  addons={addons}
                  onChange={setAddons}
                  baseCurrency={baseCurrency}
                  isDisabled={isDisabled}
                />

                <CustomFormFields table="supplierProcess" />
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

function PriceBreaks({
  priceBreaks,
  onChange,
  baseCurrency,
  isDisabled
}: {
  priceBreaks: PriceBreakRow[];
  onChange: React.Dispatch<React.SetStateAction<PriceBreakRow[]>>;
  baseCurrency: string;
  isDisabled: boolean;
}) {
  const formatter = useCurrencyFormatter();

  const removeRow = useCallback(
    (index: number) => {
      onChange((prev) => prev.filter((_, i) => i !== index));
    },
    [onChange]
  );

  const addRow = useCallback(() => {
    onChange((prev) => [...prev, { quantity: 0, unitPrice: 0 }]);
  }, [onChange]);

  const noOpMutation = useCallback(
    async (_accessorKey: string, _newValue: unknown, _row: PriceBreakRow) =>
      ({
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK"
      }) as const,
    []
  );

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber(noOpMutation),
      unitPrice: EditableNumber(noOpMutation, {
        formatOptions: { style: "currency", currency: baseCurrency }
      })
    }),
    [noOpMutation, baseCurrency]
  );

  const columns = useMemo<ColumnDef<PriceBreakRow>[]>(
    () => [
      {
        accessorKey: "quantity",
        header: "Quantity",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[80px]">
            <span>{row.original.quantity}</span>
            {!isDisabled && (
              <div className="relative w-6 h-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Price break actions"
                      icon={<LuEllipsisVertical />}
                      size="md"
                      className="absolute right-[-1px] top-[-6px]"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => removeRow(row.index)}
                      destructive
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete Price Break
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </HStack>
        )
      },
      {
        accessorKey: "unitPrice",
        header: "Unit Price",
        cell: ({ row }) => formatter.format(row.original.unitPrice)
      }
    ],
    [isDisabled, removeRow, formatter]
  );

  return (
    <div className="space-y-3 w-full">
      <span className="font-medium text-sm">Price Breaks</span>
      <Grid<PriceBreakRow>
        data={priceBreaks}
        columns={columns}
        canEdit={!isDisabled}
        editableComponents={editableComponents}
        onDataChange={onChange}
        onNewRow={!isDisabled ? addRow : undefined}
        contained={false}
      />
    </div>
  );
}

function Addons({
  addons,
  onChange,
  baseCurrency,
  isDisabled
}: {
  addons: AddonRow[];
  onChange: React.Dispatch<React.SetStateAction<AddonRow[]>>;
  baseCurrency: string;
  isDisabled: boolean;
}) {
  const formatter = useCurrencyFormatter();

  const removeRow = useCallback(
    (index: number) => {
      onChange((prev) => prev.filter((_, i) => i !== index));
    },
    [onChange]
  );

  const addRow = useCallback(() => {
    onChange((prev) => [
      ...prev,
      { name: "", amount: 0, feeType: "flat" as const }
    ]);
  }, [onChange]);

  const noOpMutation = useCallback(
    async (_accessorKey: string, _newValue: unknown, _row: AddonRow) =>
      ({
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK"
      }) as const,
    []
  );

  const editableComponents = useMemo(
    () => ({
      name: EditableText(noOpMutation),
      amount: EditableNumber(noOpMutation, {
        formatOptions: { style: "currency", currency: baseCurrency }
      })
    }),
    [noOpMutation, baseCurrency]
  );

  const updateFeeType = useCallback(
    (index: number, feeType: "flat" | "per-piece") => {
      onChange((prev) =>
        prev.map((row, i) => (i === index ? { ...row, feeType } : row))
      );
    },
    [onChange]
  );

  const columns = useMemo<ColumnDef<AddonRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <span>{row.original.name || "—"}</span>
            {!isDisabled && (
              <div className="relative w-6 h-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Addon actions"
                      icon={<LuEllipsisVertical />}
                      size="md"
                      className="absolute right-[-1px] top-[-6px]"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => removeRow(row.index)}
                      destructive
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete Add-on
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </HStack>
        )
      },
      {
        accessorKey: "amount",
        header: "Amount",
        cell: ({ row }) => formatter.format(row.original.amount)
      },
      {
        accessorKey: "feeType",
        header: "Fee Type",
        cell: ({ row }) => (
          <Select
            value={row.original.feeType}
            onValueChange={(value) =>
              updateFeeType(row.index, value as "flat" | "per-piece")
            }
            disabled={isDisabled}
          >
            <SelectTrigger className="h-8 min-w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Flat</SelectItem>
              <SelectItem value="per-piece">Per Piece</SelectItem>
            </SelectContent>
          </Select>
        )
      }
    ],
    [isDisabled, removeRow, formatter, updateFeeType]
  );

  return (
    <div className="space-y-3 w-full">
      <span className="font-medium text-sm">Add-on Fees</span>
      <Grid<AddonRow>
        data={addons}
        columns={columns}
        canEdit={!isDisabled}
        editableComponents={editableComponents}
        onDataChange={onChange}
        onNewRow={!isDisabled ? addRow : undefined}
        contained={false}
      />
    </div>
  );
}

export default SupplierProcessForm;
