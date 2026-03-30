import { openai } from "@ai-sdk/openai";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { generateText } from "ai";
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

  const { email_id, from, subject, attachments, text, html } = event.data;

  // Log full payload structure for debugging
  console.log(
    "Resend inbound webhook data keys:",
    Object.keys(event.data),
    "has text:",
    !!text,
    "has html:",
    !!html,
    "attachments count:",
    attachments?.length ?? 0,
    "attachment keys:",
    attachments?.[0] ? Object.keys(attachments[0]) : "none"
  );

  // Idempotency: check if sales RFQ already exists for this email ID
  const existing = await client
    .from("salesRfq")
    .select("id")
    .eq("companyId", companyId)
    .eq("emailId", email_id)
    .maybeSingle();

  if (existing.data) {
    return Response.json({ success: true, message: "Already processed" });
  }

  // Get email content — prefer inline webhook data, fall back to API
  let emailText: string = text || "";
  let emailHtml: string = html || "";

  if (!emailText && !emailHtml) {
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
        emailHtml = emailData.html || "";
      }
    } catch {
      // Continue without email body if fetch fails
    }
  }

  // Generate AI summary of the email
  let summary = "";
  const emailContent = emailText || emailHtml;
  if (emailContent) {
    try {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: `Summarize the following email into a concise RFQ summary. Extract key details like: what is being requested, quantities, materials, deadlines, and any special requirements. Keep it brief and actionable.\n\nFrom: ${from}\nSubject: ${subject}\n\n${emailContent}`,
        temperature: 0.2
      });
      summary = result.text;
    } catch {
      summary = `From: ${from}\nSubject: ${subject}`;
    }
  } else {
    summary = `From: ${from}\nSubject: ${subject}\n\n(no email body retrieved)`;
  }

  // Generate RFQ sequence ID
  const nextSequence = await getNextSequence(client, "salesRfq", companyId);
  if (nextSequence.error) {
    return new Response("Failed to get next sequence", { status: 500 });
  }

  const rfqId = nextSequence.data;

  // Create opportunity (salesRfq requires an associated opportunity)
  const { data: opportunity, error: oppError } = await client
    .from("opportunity")
    .insert({ companyId })
    .select("id")
    .single();

  if (oppError || !opportunity) {
    console.error("Failed to create opportunity:", oppError);
    return new Response("Failed to create opportunity", { status: 500 });
  }

  // Create sales RFQ with AI summary in notes and emailId for idempotency
  const { data: rfq, error: rfqError } = await client
    .from("salesRfq")
    .insert({
      rfqId,
      status: "Draft",
      internalNotes: summary,
      emailId: email_id,
      opportunityId: opportunity.id,
      companyId
    })
    .select("id")
    .single();

  if (rfqError || !rfq) {
    console.error("Failed to create sales RFQ:", rfqError);
    return new Response("Failed to create sales RFQ", { status: 500 });
  }

  // Upload the raw email chain as a file
  const uploadedFiles: string[] = [];

  if (emailContent) {
    const isHtml = !!emailHtml;
    const emailFileName = `email-chain.${isHtml ? "html" : "txt"}`;
    const emailFileContent = isHtml ? emailHtml : emailText;
    const emailStoragePath = `${companyId}/sales-rfq/${rfq.id}/${emailFileName}`;

    const { error: emailUploadError } = await client.storage
      .from("private")
      .upload(emailStoragePath, new TextEncoder().encode(emailFileContent), {
        contentType: isHtml ? "text/html" : "text/plain",
        upsert: true
      });

    if (!emailUploadError) {
      const sizeKb = Math.round(
        new TextEncoder().encode(emailFileContent).byteLength / 1024
      );
      await client.from("document").insert({
        path: emailStoragePath,
        name: emailFileName,
        size: sizeKb || 1,
        type: isHtml ? "html" : "txt",
        sourceDocument: "Request for Quote",
        sourceDocumentId: rfq.id,
        readGroups: [],
        writeGroups: [],
        companyId,
        createdBy: companyId
      });
      uploadedFiles.push(emailFileName);
    }
  }

  // Process email attachments
  if (attachments?.length > 0) {
    for (const attachment of attachments) {
      try {
        const fileName = attachment.filename || `attachment-${attachment.id}`;
        let fileBuffer: ArrayBuffer | null = null;

        // Try inline content first (inbound emails include base64 content)
        if (attachment.content) {
          fileBuffer = Buffer.from(attachment.content, "base64").buffer;
        }

        // Fall back to download_url if provided
        if (!fileBuffer && attachment.download_url) {
          const fileResponse = await fetch(attachment.download_url);
          if (fileResponse.ok) {
            fileBuffer = await fileResponse.arrayBuffer();
          }
        }

        // Last resort: try the Resend API (works for sent emails only)
        if (!fileBuffer) {
          try {
            const attResponse = await fetch(
              `https://api.resend.com/emails/${email_id}/attachments/${attachment.id}`,
              { headers: { Authorization: `Bearer ${apiKey}` } }
            );
            if (attResponse.ok) {
              const attData = await attResponse.json();
              if (attData.download_url) {
                const fileResponse = await fetch(attData.download_url);
                if (fileResponse.ok) {
                  fileBuffer = await fileResponse.arrayBuffer();
                }
              }
            }
          } catch {
            // API fallback failed
          }
        }

        if (!fileBuffer) {
          console.error(
            `Could not retrieve content for attachment ${attachment.id} (${fileName}). Keys:`,
            Object.keys(attachment)
          );
          continue;
        }

        // Upload to Supabase storage
        const storagePath = `${companyId}/sales-rfq/${rfq.id}/${fileName}`;
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
          size: Math.round(fileBuffer.byteLength / 1024) || 1,
          type: fileExtension,
          sourceDocument: "Request for Quote",
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
