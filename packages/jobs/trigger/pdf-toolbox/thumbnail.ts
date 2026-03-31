import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { executePdfToolbox } from "./executor";
import { pdfQueue } from "./queue";

export const pdfThumbnailTask = schemaTask({
  id: "pdf-toolbox.thumbnail",
  schema: z.object({
    companyId: z.string(),
    modelId: z.string(),
    inputPath: z.string(),
  }),
  queue: pdfQueue,
  run: async (payload) => {
    const result = await executePdfToolbox({
      companyId: payload.companyId,
      inputPath: payload.inputPath,
      outputDir: `${payload.companyId}/thumbnails/${payload.modelId}`,
      cliArgs: [
        "--thumbnails",
        "--firstpageonly",
        "--resolution=300",
        "--imgformat=png",
      ],
      outputExtension: "png",
      outputFileName: `${payload.modelId}.png`,
    });

    const client = getCarbonServiceRole();
    await client
      .from("modelUpload")
      .update({ thumbnailPath: result.outputPath })
      .eq("id", payload.modelId);

    return result;
  },
});
