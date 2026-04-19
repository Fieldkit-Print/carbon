import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { getUnitOfMeasuresList } from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Fieldkit | Services" }];
};

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.items,
  module: "items"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const [unitOfMeasures] = await Promise.all([
    getUnitOfMeasuresList(client, companyId)
  ]);

  return {
    unitOfMeasures: unitOfMeasures?.data ?? []
  };
}

export default function ServiceRoute() {
  return <Outlet />;
}
