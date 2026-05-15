/**
 * Shipstation Custom Store — Basic-auth check for inbound traffic
 *
 * Shipstation authenticates its polling + shipnotify POSTs to our
 * Custom Store URL with HTTP Basic. Credentials are configured in
 * Shipstation's UI and stored on the Carbon side in
 * `companyIntegration.metadata` so the same pair can be rotated per
 * tenant. We match in constant time.
 *
 * @see {@link file://./client.server.ts} for the integration shape
 */

import { timingSafeEqual } from "node:crypto";

import type { ShipstationIntegrationMetadata } from "./client.server";

/**
 * Returns true when the request's basic-auth header matches the
 * stored Custom Store credentials. False on header missing /
 * malformed / mismatch.
 */
export function verifyShipstationBasicAuth(
  request: Request,
  metadata: ShipstationIntegrationMetadata
): boolean {
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("basic ")) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }

  const sep = decoded.indexOf(":");
  if (sep === -1) return false;

  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  return (
    timingSafeBufferEqual(username, metadata.basicAuthUsername) &&
    timingSafeBufferEqual(password, metadata.basicAuthPassword)
  );
}

function timingSafeBufferEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
