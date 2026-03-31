import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Badge, HStack, VStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { Hyperlink, ItemThumbnail, Table } from "~/components";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Customer Assets",
  to: path.to.customerAssets
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts } = getGenericQueryFilters(searchParams);

  let query = client
    .from("parts")
    .select(
      "id, readableIdWithRevision, name, thumbnailPath, customerId, customer:customerId(name)",
      { count: "exact" }
    )
    .eq("companyId", companyId)
    .not("customerId", "is", null);

  if (search) {
    query = query.or(
      `readableIdWithRevision.ilike.%${search}%,name.ilike.%${search}%`
    );
  }

  if (sorts) {
    for (const sort of sorts) {
      query = query.order(sort.column, {
        ascending: sort.ascending
      });
    }
  } else {
    query = query.order("readableIdWithRevision", { ascending: true });
  }

  if (limit) {
    query = query.range(offset, offset + limit - 1);
  }

  const result = await query;

  if (result.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(null, "Error loading customer assets"))
    );
  }

  return {
    customerAssets: result.data ?? [],
    count: result.count ?? 0
  };
}

type CustomerAsset = {
  id: string;
  readableIdWithRevision: string | null;
  name: string | null;
  thumbnailPath: string | null;
  customerId: string | null;
  customer: { name: string } | null;
};

export default function CustomerAssetsRoute() {
  const { customerAssets, count } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<CustomerAsset>[]>(
    () => [
      {
        accessorKey: "readableIdWithRevision",
        header: "Part ID",
        cell: ({ row }) => (
          <HStack>
            <ItemThumbnail
              thumbnailPath={row.original.thumbnailPath}
              size="sm"
            />
            <Hyperlink to={path.to.part(row.original.id)}>
              {row.original.readableIdWithRevision}
            </Hyperlink>
          </HStack>
        )
      },
      {
        accessorKey: "name",
        header: "Description",
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "customer",
        header: "Customer",
        cell: ({ row }) => {
          const customer = row.original.customer as { name: string } | null;
          return customer?.name ? (
            <Badge variant="secondary">{customer.name}</Badge>
          ) : null;
        }
      }
    ],
    []
  );

  return (
    <VStack spacing={0} className="h-full">
      <Table<CustomerAsset>
        data={customerAssets as CustomerAsset[]}
        count={count}
        columns={columns}
        onRowClick={(row) => navigate(path.to.part(row.id))}
        withSearch
        withPagination
      />
      <Outlet />
    </VStack>
  );
}
