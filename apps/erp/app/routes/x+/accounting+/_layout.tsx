import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet, redirect } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import { getAccountsList, getBaseCurrency } from "~/modules/accounting";
import useAccountingSubmodules from "~/modules/accounting/ui/useAccountingSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Fieldkit | Finance" }];
};

export const handle: Handle = {
  breadcrumb: "Finance",
  to: path.to.currencies,
  module: "accounting"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const [accounts, baseCurrency] = await Promise.all([
    getAccountsList(client, companyId, {
      type: "Posting"
    }),
    getBaseCurrency(client, companyId)
  ]);

  if (accounts.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(accounts.error, "Failed to fetch accounts"))
    );
  }

  return {
    baseCurrency: baseCurrency.data,
    balanceSheetAccounts:
      accounts.data.filter((a) => a.incomeBalance === "Balance Sheet") ?? [],
    incomeStatementAccounts:
      accounts.data.filter((a) => a.incomeBalance === "Income Statement") ?? []
  };
}

export default function AccountingRoute() {
  const { groups } = useAccountingSubmodules();

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_1fr] w-full h-full bg-card">
        <GroupedContentSidebar groups={groups} />
        <VStack spacing={0} className="h-full">
          <Outlet />
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
