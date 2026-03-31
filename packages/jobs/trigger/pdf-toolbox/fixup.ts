import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { executePdfToolbox } from "./executor";
import { pdfQueue } from "./queue";

export const pdfFixupTask = schemaTask({
  id: "pdf-toolbox.fixup",
  schema: z.object({
    companyId: z.string(),
    inputPath: z.string(),
    outputDir: z.string(),
    /** Name of the process plan file (e.g. "embed-fonts.kfpx") */
    processPlan: z.string(),
    outputFileName: z.string().optional(),
  }),
  queue: pdfQueue,
  run: async (payload) => {
    return executePdfToolbox({
      companyId: payload.companyId,
      inputPath: payload.inputPath,
      outputDir: payload.outputDir,
      processPlan: payload.processPlan,
      outputExtension: "pdf",
      outputFileName: payload.outputFileName,
    });
  },
});
