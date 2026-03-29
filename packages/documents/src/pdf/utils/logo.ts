import { Resvg } from "@resvg/resvg-js";

/**
 * Resolves a logo URL to a format compatible with @react-pdf/renderer.
 *
 * For raster images (PNG/JPG), the URL is returned as-is.
 *
 * For SVGs, the file is fetched and rasterized to a PNG data URI
 * because react-pdf's Image component doesn't support SVG.
 */
export async function resolveLogoForPdf(
  logoUrl: string | null | undefined
): Promise<string | null> {
  if (!logoUrl) return null;

  const isSvg = logoUrl.endsWith(".svg") || logoUrl.includes("image/svg+xml");

  if (!isSvg) {
    return logoUrl;
  }

  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return null;

    const svgText = await response.text();
    const resvg = new Resvg(svgText, {
      fitTo: { mode: "height", value: 200 }
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    return `data:image/png;base64,${Buffer.from(pngBuffer).toString("base64")}`;
  } catch {
    return null;
  }
}
