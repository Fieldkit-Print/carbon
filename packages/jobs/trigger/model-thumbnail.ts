import { SUPABASE_ANON_KEY, SUPABASE_URL, VERCEL_URL } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isPdfFile } from "@carbon/utils";

import { task } from "@trigger.dev/sdk";
import { executePdfToolbox } from "./pdf-toolbox/executor";

const isLocal = VERCEL_URL === undefined || VERCEL_URL.includes("localhost");

const getModelUrl = (modelId: string) => {
  const domain = isLocal ? "http://localhost:3000" : VERCEL_URL;
  return `${domain}/file/model/${modelId}`;
};

export const modelThumbnailTask = task({
  id: "model-thumbnail",
  run: async (payload: { modelId: string; companyId: string }) => {
    const { modelId, companyId } = payload;

    if (isLocal) {
      console.log("Skipping model-thumbnail task on local", { payload });
      return;
    }

    console.log("Starting model-thumbnail task", { payload });
    const client = getCarbonServiceRole();

    // Look up the modelUpload record to check if it's a PDF
    const { data: modelUpload, error: lookupError } = await client
      .from("modelUpload")
      .select("modelPath, name")
      .eq("id", modelId)
      .single();

    if (lookupError || !modelUpload?.modelPath) {
      console.error("Failed to look up modelUpload", { error: lookupError });
      throw new Error("Failed to look up modelUpload record");
    }

    if (isPdfFile(modelUpload.modelPath)) {
      // PDF/AI: render first page to PNG via pdfToolbox
      console.log("Generating PDF thumbnail via pdfToolbox", {
        modelPath: modelUpload.modelPath,
      });

      const thumbnailPath = `${companyId}/thumbnails/${modelId}/${modelId}.jpg`;

      await executePdfToolbox({
        companyId,
        inputPath: modelUpload.modelPath,
        outputDir: `${companyId}/thumbnails/${modelId}`,
        processPlan: "create-thumbnail.kfpx",
        outputExtension: "jpg",
        outputFileName: `${modelId}.jpg`,
      });

      await client
        .from("modelUpload")
        .update({ thumbnailPath })
        .eq("id", modelId);

      return;
    }

    // 3D model: use existing Puppeteer-based screenshot via edge function
    const url = getModelUrl(modelId);
    const imageUrl = `${SUPABASE_URL}/functions/v1/thumbnail`;

    const response = await fetch(imageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ url }),
    });

    if (response.status !== 200) {
      console.log("Failed to generate thumbnail", { response });
      throw new Error("Failed to generate thumbnail");
    }

    const thumbnailBlob = new Blob([await response.arrayBuffer()], {
      type: "image/png",
    });

    const fileName = `${modelId}.png`;
    const thumbnailFile = new File([thumbnailBlob], fileName, {
      type: "image/png",
    });

    console.log("Uploading thumbnail", { fileName });

    const { data, error } = await client.storage
      .from("private")
      .upload(`${companyId}/thumbnails/${modelId}/${fileName}`, thumbnailFile, {
        upsert: true,
      });

    if (error) {
      console.error("Failed to upload thumbnail", { error });
    }

    const result = await client
      .from("modelUpload")
      .update({
        thumbnailPath: data?.path,
      })
      .eq("id", modelId);

    if (result.error) {
      console.error("Failed to update thumbnail path", {
        error: result.error,
      });
    }
  },
});
