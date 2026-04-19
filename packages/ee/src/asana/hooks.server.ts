import { getAsanaClient } from "./lib/client";

export async function asanaHealthcheck(
  companyId: string,
  _: Record<string, unknown>
) {
  const asana = getAsanaClient();
  return await asana.healthcheck(companyId);
}
