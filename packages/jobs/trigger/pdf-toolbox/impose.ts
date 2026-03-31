import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { executePdfToolbox } from "./executor";
import { pdfQueue } from "./queue";

const impositionType = z.enum(["2up", "4up", "booklet", "step-and-repeat"]);

export const pdfImposeTask = schemaTask({
  id: "pdf-toolbox.impose",
  schema: z.object({
    companyId: z.string(),
    inputPath: z.string(),
    outputDir: z.string(),
    /** Imposition layout type */
    layout: impositionType,
    outputFileName: z.string().optional(),
  }),
  queue: pdfQueue,
  run: async (payload) => {
    const planMap: Record<z.infer<typeof impositionType>, string> = {
      "2up": "impose-2up.kfpx",
      "4up": "impose-4up.kfpx",
      booklet: "impose-booklet.kfpx",
      "step-and-repeat": "impose-step-and-repeat.kfpx",
    };

    return executePdfToolbox({
      companyId: payload.companyId,
      inputPath: payload.inputPath,
      outputDir: payload.outputDir,
      processPlan: planMap[payload.layout],
      outputExtension: "pdf",
      outputFileName: payload.outputFileName,
    });
  },
});
