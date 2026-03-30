import {
  QUICKBOOKS_CLIENT_ID,
  QUICKBOOKS_CLIENT_SECRET,
  VERCEL_URL
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { QuickBooks } from "@carbon/ee";
import {
  DEFAULT_SYNC_CONFIG,
  getProviderIntegration,
  ProviderID
} from "@carbon/ee/accounting";
import { quickbooksOnInstall } from "@carbon/ee/quickbooks/hooks.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  // QBO sends realmId as a query parameter alongside the OAuth code
  const realmId = url.searchParams.get("realmId");

  const qbAuthResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!qbAuthResponse.success) {
    return data({ error: "Invalid QuickBooks auth response" }, { status: 400 });
  }

  const { data: params } = qbAuthResponse;

  if (!params.state) {
    return data({ error: "Invalid state parameter" }, { status: 400 });
  }

  if (!realmId) {
    return data({ error: "Missing realmId from QuickBooks" }, { status: 400 });
  }

  if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) {
    return data({ error: "QuickBooks OAuth not configured" }, { status: 500 });
  }

  try {
    const provider = getProviderIntegration(
      client,
      companyId,
      ProviderID.QUICKBOOKS
    );

    // Exchange the authorization code for tokens
    const auth = await provider.authenticate(
      params.code,
      `${url.origin}/api/integrations/quickbooks/oauth`
    );

    if (!auth) {
      return data(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    // Fetch company info to get the company name
    // We need to make a direct request since the provider doesn't have the
    // realmId set in credentials yet
    const env =
      (process.env.QUICKBOOKS_ENVIRONMENT as "production" | "sandbox") ||
      "sandbox";
    const baseUrl =
      env === "production"
        ? "https://quickbooks.api.intuit.com"
        : "https://sandbox-quickbooks.api.intuit.com";

    const companyInfoResponse = await fetch(
      `${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: "application/json"
        }
      }
    );

    let tenantName: string | undefined;
    if (companyInfoResponse.ok) {
      try {
        const companyInfo = await companyInfoResponse.json();
        tenantName = companyInfo?.CompanyInfo?.CompanyName;
      } catch {
        // Non-critical — continue without tenant name
      }
    }

    const createdIntegration = await upsertCompanyIntegration(client, {
      id: QuickBooks.id,
      active: true,
      // @ts-ignore
      metadata: {
        syncConfig: DEFAULT_SYNC_CONFIG,
        credentials: {
          ...auth,
          tenantId: realmId,
          tenantName
        }
      },
      updatedBy: userId,
      companyId: companyId
    });

    await quickbooksOnInstall(companyId);

    if (createdIntegration?.data?.metadata) {
      const requestUrl = new URL(request.url);

      if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
        requestUrl.protocol = "http";
      }

      const redirectUrl = `${requestUrl.origin}${path.to.integrations}`;

      return redirect(redirectUrl);
    } else {
      return data(
        { error: "Failed to save QuickBooks integration" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("QuickBooks OAuth Error:", err);
    return data(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }
}
