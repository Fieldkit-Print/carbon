import { formatDate } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { Company } from "../../types";

type HeaderProps = {
  company: Company;
  title: string;
  documentId?: string | null;
  date?: string | null;
  currencyCode?: string | null;
  /** Pre-resolved logo as a data URI (handles SVG compatibility) */
  logoDataUri?: string | null;
};

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          50: "#f9fafb",
          200: "#e5e7eb",
          400: "#9ca3af",
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});

const Header = ({
  company,
  title,
  documentId,
  date,
  currencyCode,
  logoDataUri
}: HeaderProps) => {
  // Use pre-resolved data URI if available, otherwise fall back to URL
  const logoSrc = logoDataUri ?? company.logoLightIcon;

  return (
    <>
      <View style={tw("flex flex-row justify-between mb-1")}>
        <View style={tw("flex flex-col")}>
          {logoSrc ? (
            <View style={{ alignSelf: "flex-start" }}>
              <Image
                src={logoSrc}
                style={{ height: 50, width: "auto", marginBottom: 4 }}
              />
            </View>
          ) : (
            <View>
              <Text
                style={tw("text-2xl font-bold text-gray-800 tracking-tight")}
              >
                {company.name}
              </Text>
            </View>
          )}
        </View>
        <View style={tw("flex flex-col items-end justify-start")}>
          <Text style={tw("text-2xl font-bold text-gray-800 tracking-tight")}>
            {title}
          </Text>
          {documentId && (
            <Text
              style={tw("text-sm font-bold text-gray-600 tracking-tight -mt-4")}
            >
              {documentId}
            </Text>
          )}
          {date && (
            <Text style={tw("text-sm font-bold text-gray-600 tracking-tight")}>
              Date: {formatDate(date)}
            </Text>
          )}
          {currencyCode && (
            <Text style={tw("text-sm font-bold text-gray-600 tracking-tight")}>
              Currency: {currencyCode}
            </Text>
          )}
        </View>
      </View>

      {/* Divider */}
      <View style={tw("h-[1px] bg-gray-200 mb-4")} />
    </>
  );
};

export { Header };
