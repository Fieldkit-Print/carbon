import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { executePdfToolbox } from "./executor";
import { pdfQueue } from "./queue";

const targetStandard = z.enum(["pdfx4", "pdfa2b"]);

export const pdfNormalizeTask = schemaTask({
  id: "pdf-toolbox.normalize",
  schema: z.object({
    companyId: z.string(),
    inputPath: z.string(),
    outputDir: z.string(),
    /** Target PDF standard */
    standard: targetStandard.default("pdfx4"),
    outputFileName: z.string().optional(),
  }),
  queue: pdfQueue,
  run: async (payload) => {
    const planMap: Record<z.infer<typeof targetStandard>, string> = {
      pdfx4: "normalize-pdfx4.kfpx",
      pdfa2b: "normalize-pdfa2b.kfpx",
    };

    return executePdfToolbox({
      companyId: payload.companyId,
      inputPath: payload.inputPath,
      outputDir: payload.outputDir,
      processPlan: planMap[payload.standard],
      outputExtension: "pdf",
      outputFileName: payload.outputFileName,
    });
  },
});
