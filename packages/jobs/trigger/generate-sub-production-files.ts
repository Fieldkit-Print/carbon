import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { modelThumbnailTask } from "./model-thumbnail";
import { pdfFixupTask } from "./pdf-toolbox/fixup";

export const generateSubProductionFilesTask = schemaTask({
  id: "generate-sub-production-files",
  schema: z.object({
    jobId: z.string(),
    companyId: z.string(),
    modelUploadId: z.string(),
    userId: z.string(),
  }),
  run: async (payload) => {
    const { jobId, companyId, modelUploadId, userId } = payload;
    const client = getCarbonServiceRole();

    // Get the production file path
    const { data: modelUpload, error: modelError } = await client
      .from("modelUpload")
      .select("modelPath, name")
      .eq("id", modelUploadId)
      .single();

    if (modelError || !modelUpload?.modelPath) {
      throw new Error(
        `Failed to look up production file: ${modelError?.message ?? "no data"}`
      );
    }

    // Get job operations with work centers that have process plans configured
    const { data: operations, error: opsError } = await client
      .from("jobOperation")
      .select(
        "id, order, workCenterId, workCenter!inner(id, name, processPlanPath)"
      )
      .eq("jobId", jobId)
      .not("workCenter.processPlanPath", "is", null)
      .order("order");

    if (opsError) {
      throw new Error(
        `Failed to look up job operations: ${opsError.message}`
      );
    }

    if (!operations?.length) {
      logger.info("No operations with process plans configured, skipping", {
        jobId,
      });
      return { generated: 0 };
    }

    logger.info(
      `Generating sub-production files for ${operations.length} operations`,
      { jobId }
    );

    let generated = 0;

    for (const operation of operations) {
      const workCenter = operation.workCenter as {
        id: string;
        name: string;
        processPlanPath: string;
      };

      try {
        logger.info(`Processing operation ${operation.id}`, {
          workCenter: workCenter.name,
          processPlan: workCenter.processPlanPath,
        });

        const outputDir = `${companyId}/models/sub-production/${jobId}/${operation.id}`;
        const outputFileName = `${operation.id}.pdf`;

        // Run the PDF Toolbox fixup with the work center's process plan
        const result = await pdfFixupTask
          .triggerAndWait({
            companyId,
            inputPath: modelUpload.modelPath,
            outputDir,
            processPlan: workCenter.processPlanPath,
            outputFileName,
          })
          .unwrap();

        // Create a new modelUpload record for the sub-production file
        const subModelId = `sub_${operation.id}`;
        const { error: insertError } = await client
          .from("modelUpload")
          .upsert({
            id: subModelId,
            name: `${workCenter.name} - ${modelUpload.name}`,
            modelPath: result.outputPath,
            size: 0,
            companyId,
            createdBy: userId,
          });

        if (insertError) {
          logger.error(
            `Failed to create modelUpload for operation ${operation.id}`,
            { error: insertError.message }
          );
          continue;
        }

        // Link the sub-production file to the job operation
        const { error: updateError } = await client
          .from("jobOperation")
          .update({ modelUploadId: subModelId })
          .eq("id", operation.id);

        if (updateError) {
          logger.error(
            `Failed to update jobOperation ${operation.id}`,
            { error: updateError.message }
          );
          continue;
        }

        // Generate thumbnail for the sub-production file
        await modelThumbnailTask.trigger({
          companyId,
          modelId: subModelId,
        });

        generated++;
        logger.info(`Generated sub-production file for operation ${operation.id}`);
      } catch (err) {
        logger.error(
          `Failed to generate sub-production file for operation ${operation.id}`,
          { error: err instanceof Error ? err.message : String(err) }
        );
      }
    }

    logger.info(`Sub-production file generation complete`, {
      jobId,
      generated,
      total: operations.length,
    });

    return { generated, total: operations.length };
  },
});
