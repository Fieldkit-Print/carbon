import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) {
    return { priceBreaks: [], addons: [] };
  }

  const [priceBreaksResult, addonsResult] = await Promise.all([
    client
      .from("supplierProcessPrice")
      .select("quantity, unitPrice")
      .eq("supplierProcessId", id)
      .order("quantity", { ascending: true }),
    client
      .from("supplierProcessAddon")
      .select("name, amount, feeType")
      .eq("supplierProcessId", id)
  ]);

  return {
    priceBreaks: priceBreaksResult.data ?? [],
    addons: addonsResult.data ?? []
  };
}
