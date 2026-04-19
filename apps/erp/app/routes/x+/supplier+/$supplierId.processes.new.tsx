import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import {
  supplierProcessValidator,
  upsertSupplierProcess
} from "~/modules/purchasing";
import SupplierProcessForm from "~/modules/purchasing/ui/Supplier/SupplierProcessForm";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { supplierProcessesQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createSupplierProcess = await upsertSupplierProcess(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createSupplierProcess.error) {
    throw redirect(
      path.to.supplierProcesses(supplierId),
      await flash(
        request,
        error(createSupplierProcess.error, "Failed to create supplier process")
      )
    );
  }

  const newId = createSupplierProcess.data?.id;

  if (newId) {
    const priceBreaksRaw = formData.get("priceBreaks");
    if (priceBreaksRaw) {
      const priceBreaks = JSON.parse(priceBreaksRaw as string) as {
        quantity: number;
        unitPrice: number;
      }[];
      if (priceBreaks.length > 0) {
        await client.from("supplierProcessPrice").insert(
          priceBreaks.map((pb) => ({
            supplierProcessId: newId,
            quantity: pb.quantity,
            unitPrice: pb.unitPrice,
            companyId,
            createdBy: userId
          }))
        );
      }
    }

    const addonsRaw = formData.get("addons");
    if (addonsRaw) {
      const addons = JSON.parse(addonsRaw as string) as {
        name: string;
        amount: number;
        feeType: string;
      }[];
      if (addons.length > 0) {
        await client.from("supplierProcessAddon").insert(
          addons.map((a) => ({
            supplierProcessId: newId,
            name: a.name,
            amount: a.amount,
            feeType: a.feeType,
            companyId,
            createdBy: userId
          }))
        );
      }
    }
  }

  return modal
    ? createSupplierProcess
    : redirect(path.to.supplierProcesses(supplierId));
}

export async function clientAction({
  request,
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const formData = await request.clone().formData(); // if we. don't clone it we can't access it in the action
  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  if (validation.data.processId) {
    window.clientCache?.setQueryData(
      supplierProcessesQuery(validation.data.processId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function NewSupplierProcessRoute() {
  const { supplierId } = useParams();
  const navigate = useNavigate();

  if (!supplierId) throw new Error("Could not find supplier id");

  const initialValues = {
    supplierId: supplierId,
    processId: "",
    minimumCost: 0,
    setupCost: 0,
    leadTime: 0,
    isPreferred: false
  };

  return (
    <SupplierProcessForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
