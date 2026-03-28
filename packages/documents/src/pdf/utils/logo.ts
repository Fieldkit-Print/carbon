/**
 * Resolves a logo URL to a data URI for use in PDF rendering.
 * This is necessary because @react-pdf/renderer's Image component
 * doesn't reliably render SVG URLs from remote sources.
 *
 * For raster images (PNG/JPG), the URL is returned as-is since
 * react-pdf handles those natively.
 *
 * For SVGs, the file is fetched and converted to a base64 data URI.
 */
export async function resolveLogoForPdf(
  logoUrl: string | null | undefined
): Promise<string | null> {
  if (!logoUrl) return null;

  const isSvg = logoUrl.endsWith(".svg") || logoUrl.includes("image/svg+xml");

  if (!isSvg) {
    // Raster images work fine as URLs in react-pdf
    return logoUrl;
  }

  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return null;

    const svgText = await response.text();
    const base64 = Buffer.from(svgText).toString("base64");
    return `data:image/svg+xml;base64,${base64}`;
  } catch {
    return null;
  }
}
