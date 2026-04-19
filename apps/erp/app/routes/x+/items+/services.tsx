import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getServices } from "~/modules/items";
import { ServicesTable } from "~/modules/items/ui/Services";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Services",
  to: path.to.services
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const type = searchParams.get("type");
  const group = searchParams.get("group");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [services, tags] = await Promise.all([
    getServices(client, companyId, {
      search,
      type,
      group,
      supplierId,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList(client, companyId, "service")
  ]);

  if (services.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(services.error, "Failed to fetch services"))
    );
  }

  return {
    count: services.count ?? 0,
    services: services.data ?? [],
    tags: tags.data ?? []
  };
}

export default function ServicesSearchRoute() {
  const { count, services, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ServicesTable data={services} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
