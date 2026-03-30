import { requirePermissions } from "@carbon/auth/auth.server";
import type { QuickBooksProvider } from "@carbon/ee/accounting";
import {
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID
} from "@carbon/ee/accounting";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * GET: Fetch chart of accounts from QuickBooks
 * Returns accounts formatted for use in select dropdowns
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  try {
    const integration = await getAccountingIntegration(
      client,
      companyId,
      ProviderID.QUICKBOOKS
    );

    const provider = getProviderIntegration(
      client,
      companyId,
      integration.id,
      integration.metadata
    ) as QuickBooksProvider;

    const accounts = await provider.listAccounts();

    const options = accounts.map((account) => ({
      value: account.Id,
      label: account.AcctNum
        ? `${account.AcctNum} - ${account.Name}`
        : account.Name,
      description: account.AccountType,
      type: account.AccountType,
      class: account.Classification
    }));

    return data({ accounts: options });
  } catch (error) {
    console.error("Failed to fetch QuickBooks accounts:", error);
    return data(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch accounts",
        accounts: []
      },
      { status: 500 }
    );
  }
}
