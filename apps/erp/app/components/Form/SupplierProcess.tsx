import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { useFetcher } from "react-router";
import { useCurrencyFormatter } from "~/hooks";
import type { getSupplierProcessesByProcess } from "~/modules/purchasing";
import { SupplierProcessForm } from "~/modules/purchasing/ui/Supplier";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";

type SupplierProcessSelectProps = Omit<ComboboxProps, "options"> & {
  processId?: string;
};

const SupplierProcess = ({
  processId,
  ...props
}: SupplierProcessSelectProps) => {
  const newSupplierProcessModal = useDisclosure();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [suppliers] = useSuppliers();
  const options = useSupplierProcesses({
    processId
  }).map((supplierProcess) => {
    const supplier = suppliers.find(
      (supplier) => supplier.id === supplierProcess.supplierId
    );
    return {
      label: supplier?.name ?? "Unknown Supplier",
      value: supplierProcess.id!
    };
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        // @ts-ignore
        label={props?.label ?? "Work Center"}
        onCreateOption={(option) => {
          newSupplierProcessModal.onOpen();
        }}
      />
      {newSupplierProcessModal.isOpen && processId && (
        <SupplierProcessForm
          type="modal"
          onClose={() => {
            newSupplierProcessModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            processId,
            supplierId: "",
            minimumCost: 0,
            setupCost: 0,
            leadTime: 0,
            isPreferred: false
          }}
        />
      )}
    </>
  );
};

SupplierProcess.displayName = "SupplierProcess";

export default SupplierProcess;

export const useSupplierProcesses = (args: { processId?: string }) => {
  const { processId } = args;
  const fetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierProcessesByProcess>>>();

  useMount(() => {
    fetcher.load(path.to.api.supplierProcesses(processId));
  });

  const supplierProcesses = useMemo(
    () => (fetcher.data?.data ? fetcher.data?.data : []),
    [fetcher.data]
  );

  return supplierProcesses;
};

export const SupplierProcessPreview = ({
  processId,
  supplierProcessId
}: {
  processId: string;
  supplierProcessId?: string;
}) => {
  const [suppliers] = useSuppliers();
  const supplierProcess = useSupplierProcesses({ processId: processId });

  if (!supplierProcessId) return null;
  const supplierId = supplierProcess.find(
    (supplierProcess) => supplierProcess.id === supplierProcessId
  )?.supplierId;
  if (!supplierId) return null;

  const supplier = suppliers.find((supplier) => supplier.id === supplierId);

  return (
    <span className="text-xs text-muted-foreground">{supplier?.name}</span>
  );
};

type PriceBreak = { quantity: number; unitPrice: number };
type Addon = { name: string; amount: number; feeType: "flat" | "per-piece" };

export const SupplierProcessBreaksPreview = ({
  supplierProcessId
}: {
  supplierProcessId?: string | null;
}) => {
  const fetcher = useFetcher<{
    priceBreaks: PriceBreak[];
    addons: Addon[];
  }>();
  const formatter = useCurrencyFormatter();

  useEffect(() => {
    if (supplierProcessId) {
      fetcher.load(path.to.api.supplierProcessDetail(supplierProcessId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierProcessId]);

  if (!supplierProcessId) return null;

  const priceBreaks = fetcher.data?.priceBreaks ?? [];
  const addons = fetcher.data?.addons ?? [];

  if (priceBreaks.length === 0 && addons.length === 0) return null;

  return (
    <div className="col-span-full border border-border rounded-md p-3 bg-muted/30 flex flex-col gap-3 text-xs">
      {priceBreaks.length > 0 && (
        <div>
          <div className="font-medium mb-1">Supplier Price Breaks</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="text-muted-foreground">Quantity</div>
            <div className="text-muted-foreground">Unit Price</div>
            {priceBreaks.map((pb) => (
              <Fragment key={pb.quantity}>
                <div>{pb.quantity}</div>
                <div>{formatter.format(pb.unitPrice)}</div>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {addons.length > 0 && (
        <div>
          <div className="font-medium mb-1">Add-on Fees</div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1">
            <div className="text-muted-foreground">Name</div>
            <div className="text-muted-foreground">Amount</div>
            <div className="text-muted-foreground">Type</div>
            {addons.map((a, i) => (
              <Fragment key={`${a.name}-${i}`}>
                <div>{a.name || "—"}</div>
                <div>{formatter.format(a.amount)}</div>
                <div>{a.feeType === "flat" ? "Flat" : "Per Piece"}</div>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
