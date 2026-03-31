import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { executePdfToolbox } from "./executor";
import { pdfQueue } from "./queue";

const targetFormat = z.enum(["png", "jpg", "tiff", "pdfx4", "pdfa2b"]);

export const pdfConvertTask = schemaTask({
  id: "pdf-toolbox.convert",
  schema: z.object({
    companyId: z.string(),
    inputPath: z.string(),
    outputDir: z.string(),
    /** Target output format */
    format: targetFormat,
    /** DPI for image conversion (default 300) */
    resolution: z.number().default(300),
    outputFileName: z.string().optional(),
  }),
  queue: pdfQueue,
  run: async (payload) => {
    const isImage = ["png", "jpg", "tiff"].includes(payload.format);

    if (isImage) {
      return executePdfToolbox({
        companyId: payload.companyId,
        inputPath: payload.inputPath,
        outputDir: payload.outputDir,
        cliArgs: [
          "--renderaliasname",
          `${payload.format.toUpperCase()} ${payload.resolution}dpi`,
        ],
        outputExtension: payload.format,
        outputFileName: payload.outputFileName,
      });
    }

    // PDF standard conversion
    const planMap: Record<string, string> = {
      pdfx4: "normalize-pdfx4.kfpx",
      pdfa2b: "normalize-pdfa2b.kfpx",
    };

    return executePdfToolbox({
      companyId: payload.companyId,
      inputPath: payload.inputPath,
      outputDir: payload.outputDir,
      processPlan: planMap[payload.format],
      outputExtension: "pdf",
      outputFileName: payload.outputFileName,
    });
  },
});
