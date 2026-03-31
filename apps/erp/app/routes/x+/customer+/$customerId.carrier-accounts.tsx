import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { CustomerCarrierAccounts } from "~/modules/sales/ui/Customer";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const { data: carrierAccounts, error: err } = await client
    .from("customerCarrierAccount")
    .select("id, carrier, accountNumber, description")
    .eq("customerId", customerId)
    .order("createdAt");

  if (err) {
    throw redirect(
      path.to.customer(customerId),
      await flash(request, error(err, "Failed to load carrier accounts"))
    );
  }

  return { carrierAccounts: carrierAccounts ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const formData = await request.formData();
  const type = String(formData.get("type"));

  switch (type) {
    case "create": {
      const carrier = String(formData.get("carrier"));
      const accountNumber = String(formData.get("accountNumber"));
      const description = String(formData.get("description")) || null;

      const { error: err } = await client
        .from("customerCarrierAccount")
        .insert({
          customerId,
          carrier: carrier as any,
          accountNumber,
          description,
          companyId,
          createdBy: userId
        });

      if (err) {
        throw redirect(
          path.to.customerCarrierAccounts(customerId),
          await flash(request, error(err, "Failed to add carrier account"))
        );
      }

      throw redirect(
        path.to.customerCarrierAccounts(customerId),
        await flash(request, success("Carrier account added"))
      );
    }

    case "delete": {
      const carrierAccountId = String(formData.get("carrierAccountId"));
      const { error: err } = await client
        .from("customerCarrierAccount")
        .delete()
        .eq("id", carrierAccountId);

      if (err) {
        throw redirect(
          path.to.customerCarrierAccounts(customerId),
          await flash(request, error(err, "Failed to remove carrier account"))
        );
      }

      throw redirect(
        path.to.customerCarrierAccounts(customerId),
        await flash(request, success("Carrier account removed"))
      );
    }

    default:
      throw redirect(
        path.to.customerCarrierAccounts(customerId),
        await flash(request, error(null, "Invalid action"))
      );
  }
}

export default function CustomerCarrierAccountsRoute() {
  const { carrierAccounts } = useLoaderData<typeof loader>();
  const { customerId } = useParams();

  return (
    <CustomerCarrierAccounts
      carrierAccounts={carrierAccounts}
      customerId={customerId ?? ""}
    />
  );
}
