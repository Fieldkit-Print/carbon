import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useRouteData } from "@carbon/remix";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { ResizablePanels } from "~/components/Layout";
import type { ItemFile, ServiceSummary } from "~/modules/items";
import { getItemFiles, getService, getSupplierParts } from "~/modules/items";
import { ServiceHeader, ServiceProperties } from "~/modules/items/ui/Services";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Services",
  to: path.to.services,
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [serviceSummary, supplierParts, tags] = await Promise.all([
    getService(client, itemId, companyId),
    getSupplierParts(client, itemId, companyId),
    getTagsList(client, companyId, "service")
  ]);

  if (serviceSummary.error) {
    throw redirect(
      path.to.services,
      await flash(
        request,
        error(serviceSummary.error, "Failed to load service summary")
      )
    );
  }

  return {
    serviceSummary: serviceSummary.data,
    files: getItemFiles(client, itemId, companyId),
    supplierParts: supplierParts.data ?? [],
    tags: tags.data ?? []
  };
}

export default function ServiceRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const serviceData = useRouteData<{
    serviceSummary: ServiceSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.service(itemId));

  if (!serviceData) throw new Error("Could not find service data");

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <ServiceHeader />
      <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
        <div className="flex flex-grow overflow-hidden">
          <ResizablePanels
            content={
              <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                <Outlet />
              </div>
            }
            properties={<ServiceProperties />}
          />
        </div>
      </div>
    </div>
  );
}
