import { getCarbonServiceRole } from "@carbon/auth/client.server";
import crypto from "crypto";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getIntegration, getNextSequence } from "~/modules/settings";

const integrationValidator = z.object({
  apiKey: z.string(),
  webhookSecret: z.string().optional()
});

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { companyId } = params;
  if (!companyId) {
    return new Response("Missing companyId", { status: 400 });
  }

  const client = await getCarbonServiceRole();

  // Fetch webhook secret from Resend integration settings
  const resendIntegration = await getIntegration(client, "resend", companyId);
  const metadata = integrationValidator.safeParse(
    resendIntegration.data?.metadata
  );

  if (!metadata.success || !metadata.data.webhookSecret) {
    return new Response("Webhook secret not configured in Resend integration", {
      status: 500
    });
  }

  const { webhookSecret, apiKey } = metadata.data;

  // Read raw body for signature verification
  const payload = await request.text();

  // Verify Svix signature (Resend uses Svix for webhooks)
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing signature headers", { status: 400 });
  }

  const secretBytes = Buffer.from(
    webhookSecret.replace("whsec_", ""),
    "base64"
  );
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  const signatures = svixSignature.split(" ");
  const isValid = signatures.some((sig) => {
    const sigValue = sig.split(",")[1];
    return sigValue === expectedSignature;
  });

  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Parse webhook event
  const event = JSON.parse(payload);

  if (event.type !== "email.received") {
    return Response.json({ success: true, message: "Ignored event type" });
  }

  const { email_id, from, subject, attachments } = event.data;

  // Idempotency: check if RFQ already exists for this email
  const existing = await client
    .from("purchasingRfq")
    .select("id")
    .eq("companyId", companyId)
    .ilike("internalNotes", `%[email:${email_id}]%`)
    .maybeSingle();

  if (existing.data) {
    return Response.json({ success: true, message: "Already processed" });
  }

  // Fetch full email content from Resend API
  let emailText = "";
  try {
    const emailResponse = await fetch(
      `https://api.resend.com/emails/${email_id}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` }
      }
    );
    if (emailResponse.ok) {
      const emailData = await emailResponse.json();
      emailText = emailData.text || "";
    }
  } catch {
    // Continue without email body if fetch fails
  }

  // Generate RFQ sequence ID
  const nextSequence = await getNextSequence(
    client,
    "purchasingRfq",
    companyId
  );
  if (nextSequence.error) {
    return new Response("Failed to get next sequence", { status: 500 });
  }

  const rfqId = nextSequence.data;
  const today = new Date().toISOString().split("T")[0];

  const notesText = [
    `From: ${from}`,
    `Subject: ${subject}`,
    "",
    emailText || "(no text body)"
  ].join("\n");

  // Create RFQ
  const { data: rfq, error: rfqError } = await client
    .from("purchasingRfq")
    .insert({
      rfqId,
      rfqDate: today,
      status: "Draft",
      notes: notesText,
      internalNotes: `[email:${email_id}] Created from inbound email`,
      companyId
    })
    .select("id")
    .single();

  if (rfqError || !rfq) {
    console.error("Failed to create RFQ:", rfqError);
    return new Response("Failed to create RFQ", { status: 500 });
  }

  // Process attachments
  const uploadedFiles: string[] = [];

  if (attachments?.length > 0) {
    for (const attachment of attachments) {
      try {
        // Fetch attachment metadata with download URL
        const attResponse = await fetch(
          `https://api.resend.com/emails/${email_id}/attachments/${attachment.id}`,
          {
            headers: { Authorization: `Bearer ${apiKey}` }
          }
        );

        if (!attResponse.ok) continue;

        const attData = await attResponse.json();
        if (!attData.download_url) continue;

        // Download the file content
        const fileResponse = await fetch(attData.download_url);
        if (!fileResponse.ok) continue;

        const fileBuffer = await fileResponse.arrayBuffer();
        const fileName = attachment.filename || `attachment-${attachment.id}`;

        // Upload to Supabase storage
        const storagePath = `${companyId}/purchasing-rfq/${rfq.id}/${fileName}`;
        const { error: uploadError } = await client.storage
          .from("private")
          .upload(storagePath, fileBuffer, {
            contentType: attachment.content_type || "application/octet-stream",
            upsert: true
          });

        if (uploadError) {
          console.error(`Failed to upload ${fileName}:`, uploadError);
          continue;
        }

        // Create document record
        const fileExtension = fileName.split(".").pop() || "unknown";
        await client.from("document").insert({
          path: storagePath,
          name: fileName,
          size: Math.round(fileBuffer.byteLength / 1024),
          type: fileExtension,
          sourceDocument: "Purchasing Request for Quote",
          sourceDocumentId: rfq.id,
          readGroups: [],
          writeGroups: [],
          companyId,
          createdBy: companyId
        });

        uploadedFiles.push(fileName);
      } catch (err) {
        console.error(`Error processing attachment:`, err);
      }
    }
  }

  return Response.json({
    success: true,
    rfqId: rfq.id,
    attachments: uploadedFiles.length
  });
}
