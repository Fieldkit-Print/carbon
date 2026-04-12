import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Fieldkit | Schedule" }];
};

export const handle: Handle = {
  breadcrumb: "Production",
  to: path.to.production,
  module: "production"
};

export default function SchedulingRoute() {
  return <Outlet />;
}
