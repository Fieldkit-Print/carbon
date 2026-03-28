import { Image, Text } from "@react-pdf/renderer";

type LogoProps = {
  src: string;
  style?: Record<string, unknown>;
  fallbackText?: string;
};

/**
 * Renders a company logo in a PDF document.
 * Handles both raster images (PNG/JPG) and SVG URLs.
 *
 * For SVGs, react-pdf's Image component doesn't reliably render SVG URLs,
 * so we use the URL directly and let react-pdf attempt to handle it.
 * If the logo URL ends in .svg, we still pass it to Image — react-pdf v3+
 * can handle SVG data URIs and some SVG URLs.
 */
const Logo = ({ src, style, fallbackText }: LogoProps) => {
  if (!src) {
    if (fallbackText) {
      return <Text>{fallbackText}</Text>;
    }
    return null;
  }

  // react-pdf Image component handles PNG, JPG, and attempts SVG
  return <Image src={src} style={style} />;
};

export { Logo };
