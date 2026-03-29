import { SUPABASE_ANON_KEY, SUPABASE_URL, VERCEL_URL } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isPdfFile } from "@carbon/utils";

import { task } from "@trigger.dev/sdk";

const isLocal = VERCEL_URL === undefined || VERCEL_URL.includes("localhost");

const getModelUrl = (modelId: string) => {
  const domain = isLocal ? "http://localhost:3000" : VERCEL_URL;
  return `${domain}/file/model/${modelId}`;
};

async function generatePdfThumbnail(
  client: ReturnType<typeof getCarbonServiceRole>,
  modelPath: string,
): Promise<Uint8Array> {
  const { data: fileData, error: downloadError } = await client.storage
    .from("private")
    .download(modelPath);

  if (downloadError || !fileData) {
    throw new Error(`Failed to download PDF: ${downloadError?.message}`);
  }

  const pdfBuffer = Buffer.from(await fileData.arrayBuffer());

  const { pdf } = await import("pdf-to-img");
  const pages = await pdf(pdfBuffer, { scale: 2 });

  // Render only the first page
  for await (const page of pages) {
    return page;
  }

  throw new Error("PDF has no pages");
}

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

    const fileName = `${modelId}.png`;
    let thumbnailBlob: Blob;

    if (isPdfFile(modelUpload.modelPath)) {
      // PDF: render first page server-side
      console.log("Generating PDF thumbnail", { modelPath: modelUpload.modelPath });
      const pngData = await generatePdfThumbnail(client, modelUpload.modelPath);
      thumbnailBlob = new Blob([pngData], { type: "image/png" });
    } else {
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

      thumbnailBlob = new Blob([await response.arrayBuffer()], {
        type: "image/png",
      });
    }

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
      console.error("Failed to update thumbnail path", { error: result.error });
    }
  },
});
