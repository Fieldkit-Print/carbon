import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { getEntityForUploadLink } from "~/modules/sales";
import { getExternalLink } from "~/modules/shared";
import { stripSpecialCharacters } from "~/utils/string";

async function validateLink(id: string) {
  const serviceRole = getCarbonServiceRole();

  const externalLink = await getExternalLink(serviceRole, id);
  if (externalLink.error || !externalLink.data) {
    return { error: "Link not found", status: 404 } as const;
  }

  if (
    externalLink.data.expiresAt &&
    new Date(externalLink.data.expiresAt) < new Date()
  ) {
    return { error: "Link has expired", status: 410 } as const;
  }

  const entity = await getEntityForUploadLink(
    serviceRole,
    externalLink.data.documentId
  );
  if (!entity) {
    return { error: "Entity not found", status: 404 } as const;
  }

  return { serviceRole, entity } as const;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { id } = params;
  if (!id) {
    return data({ error: "Missing link ID" }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "sign") {
    const fileName = formData.get("fileName") as string;
    if (!fileName) {
      return data({ error: "Missing fileName" }, { status: 400 });
    }

    const result = await validateLink(id);
    if ("error" in result) {
      return data({ error: result.error }, { status: result.status });
    }

    const { serviceRole, entity } = result;
    const sanitizedName = stripSpecialCharacters(fileName);
    const storagePath = `${entity.companyId}/opportunity/${entity.opportunityId}/${sanitizedName}`;

    const { data: signedUrl, error } = await serviceRole.storage
      .from("private")
      .createSignedUploadUrl(storagePath, { upsert: true });

    if (error || !signedUrl) {
      return data({ error: "Failed to create upload URL" }, { status: 500 });
    }

    return data({
      signedUrl: signedUrl.signedUrl,
      token: signedUrl.token,
      path: signedUrl.path,
      storagePath
    });
  }

  if (intent === "record") {
    const fileName = formData.get("fileName") as string;
    const fileSize = Number(formData.get("fileSize"));
    const storagePath = formData.get("storagePath") as string;

    if (!fileName || !storagePath) {
      return data({ error: "Missing file info" }, { status: 400 });
    }

    const result = await validateLink(id);
    if ("error" in result) {
      return data({ error: result.error }, { status: result.status });
    }

    const { serviceRole, entity } = result;

    await upsertDocument(serviceRole, {
      path: storagePath,
      name: fileName,
      size: Math.round(fileSize / 1024),
      sourceDocument: entity.sourceDocument,
      sourceDocumentId: entity.sourceDocumentId,
      readGroups: [entity.createdBy],
      writeGroups: [entity.createdBy],
      createdBy: entity.createdBy,
      companyId: entity.companyId
    });

    return data({ recorded: true });
  }

  return data({ error: "Invalid intent" }, { status: 400 });
}
