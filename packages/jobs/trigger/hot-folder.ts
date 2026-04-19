import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "@trigger.dev/sdk";

const HOT_FOLDER_S3_BUCKET = process.env.HOT_FOLDER_S3_BUCKET ?? "";
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: AWS_REGION });
  }
  return s3Client;
}

/**
 * Copies a file to the S3 hot folder bucket for NAS sync.
 * Failures are logged but do not throw — the pipeline should
 * succeed even if hot folder routing fails.
 */
export async function copyToHotFolder(params: {
  hotFolderPath: string;
  fileName: string;
  fileBuffer: ArrayBuffer | Uint8Array;
}): Promise<boolean> {
  if (!HOT_FOLDER_S3_BUCKET) {
    logger.warn("HOT_FOLDER_S3_BUCKET not configured, skipping hot folder copy");
    return false;
  }

  const key = `${params.hotFolderPath}/${params.fileName}`;

  try {
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: HOT_FOLDER_S3_BUCKET,
        Key: key,
        Body: new Uint8Array(params.fileBuffer),
      })
    );

    logger.info("Copied file to hot folder", { bucket: HOT_FOLDER_S3_BUCKET, key });
    return true;
  } catch (err) {
    logger.error("Failed to copy file to hot folder", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
