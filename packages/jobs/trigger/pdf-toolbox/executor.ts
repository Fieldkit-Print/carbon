import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { logger } from "@trigger.dev/sdk";

const PDFTOOLBOX_SERVICE_URL =
  process.env.PDFTOOLBOX_SERVICE_URL || "http://localhost:8080";
const PDFTOOLBOX_AUTH_TOKEN = process.env.PDFTOOLBOX_AUTH_TOKEN || "";

export interface PdfToolboxInput {
  companyId: string;
  /** Supabase Storage path of the input file */
  inputPath: string;
  /** Supabase Storage directory for output */
  outputDir: string;
  /** Name of a .kfpx process plan file (without path) */
  processPlan?: string;
  /** Additional CLI arguments */
  cliArgs?: string[];
  /** Output file extension (e.g. "png", "pdf") */
  outputExtension?: string;
  /** Override the output filename */
  outputFileName?: string;
}

export interface PdfToolboxOutput {
  /** Supabase Storage path of the result file */
  outputPath: string;
  /** pdfToolbox exit code (0=success, 1=preflight warning, 2+=error) */
  exitCode: number;
  /** CLI stdout + stderr */
  log: string;
}

/**
 * Downloads a file from Supabase Storage, sends it to the pdfToolbox
 * HTTP service for processing, and uploads the result back to storage.
 */
export async function executePdfToolbox(
  input: PdfToolboxInput
): Promise<PdfToolboxOutput> {
  const client = getCarbonServiceRole();

  // Download input file from Supabase Storage
  const { data: fileData, error: downloadError } = await client.storage
    .from("private")
    .download(input.inputPath);

  if (downloadError || !fileData) {
    throw new Error(
      `Failed to download file: ${downloadError?.message ?? "no data"}`
    );
  }

  const outputExt = input.outputExtension ?? "pdf";
  const outputFileName = input.outputFileName ?? `output.${outputExt}`;

  // Build multipart form for the pdfToolbox service
  const form = new FormData();
  form.append("file", fileData, "input.pdf");

  if (input.cliArgs?.length) {
    form.append("args", JSON.stringify(input.cliArgs));
  }
  if (input.processPlan) {
    if (input.processPlan.includes("/")) {
      // Storage path — download .kfpx from Supabase and send as file
      const { data: planData, error: planError } = await client.storage
        .from("private")
        .download(input.processPlan);

      if (planError || !planData) {
        throw new Error(
          `Failed to download process plan: ${planError?.message ?? "no data"}`
        );
      }

      form.append("processPlanFile", planData, "plan.kfpx");
    } else {
      // Filename — use baked-in process plan lookup
      form.append("processPlan", input.processPlan);
    }
  }
  form.append("outputExtension", outputExt);

  logger.info("Sending to pdfToolbox service", {
    url: `${PDFTOOLBOX_SERVICE_URL}/process`,
    inputPath: input.inputPath,
    processPlan: input.processPlan,
    cliArgs: input.cliArgs,
  });

  // Call pdfToolbox HTTP service
  const headers: Record<string, string> = {};
  if (PDFTOOLBOX_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${PDFTOOLBOX_AUTH_TOKEN}`;
  }

  const response = await fetch(`${PDFTOOLBOX_SERVICE_URL}/process`, {
    method: "POST",
    body: form,
    headers,
  });

  const exitCode = parseInt(response.headers.get("X-Exit-Code") ?? "0", 10);
  const log = response.headers.get("X-Log") ?? "";

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `pdfToolbox service error (${response.status}): ${errorBody}`
    );
  }

  logger.info("pdfToolbox service completed", { exitCode });

  // Upload result to Supabase Storage
  const resultBuffer = await response.arrayBuffer();
  const storagePath = `${input.outputDir}/${outputFileName}`;
  const resultBlob = new Blob([resultBuffer]);

  const contentTypeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    tiff: "image/tiff",
    pdf: "application/pdf",
  };

  const { error: uploadError } = await client.storage
    .from("private")
    .upload(storagePath, resultBlob, {
      upsert: true,
      contentType: contentTypeMap[outputExt] ?? "application/octet-stream",
    });

  if (uploadError) {
    throw new Error(`Failed to upload result: ${uploadError.message}`);
  }

  return {
    outputPath: storagePath,
    exitCode,
    log,
  };
}
