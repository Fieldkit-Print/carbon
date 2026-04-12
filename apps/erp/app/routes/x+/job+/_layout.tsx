import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Fieldkit | Jobs" }];
};

export const handle: Handle = {
  breadcrumb: "Production",
  to: path.to.production,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "production"
  });

  return {};
}

export default function JobRoute() {
  return <Outlet />;
}
