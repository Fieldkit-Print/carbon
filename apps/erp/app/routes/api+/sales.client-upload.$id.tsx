import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { getEntityForUploadLink } from "~/modules/sales";
import { getExternalLink } from "~/modules/shared";
import { stripSpecialCharacters } from "~/utils/string";

export async function action({ request, params }: ActionFunctionArgs) {
  const { id } = params;
  if (!id) {
    return data({ error: "Missing link ID" }, { status: 400 });
  }

  const serviceRole = getCarbonServiceRole();

  const externalLink = await getExternalLink(serviceRole, id);
  if (externalLink.error || !externalLink.data) {
    return data({ error: "Link not found" }, { status: 404 });
  }

  if (
    externalLink.data.expiresAt &&
    new Date(externalLink.data.expiresAt) < new Date()
  ) {
    return data({ error: "Link has expired" }, { status: 410 });
  }

  const entity = await getEntityForUploadLink(
    serviceRole,
    externalLink.data.documentId
  );
  if (!entity) {
    return data({ error: "Entity not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return data({ error: "No files provided" }, { status: 400 });
  }

  const uploaded: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const sanitizedName = stripSpecialCharacters(file.name);
    const storagePath = `${entity.companyId}/opportunity/${entity.opportunityId}/${sanitizedName}`;

    const fileUpload = await serviceRole.storage
      .from("private")
      .upload(storagePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true
      });

    if (fileUpload.error) {
      errors.push(file.name);
      continue;
    }

    await upsertDocument(serviceRole, {
      path: storagePath,
      name: file.name,
      size: Math.round(file.size / 1024),
      sourceDocument: entity.sourceDocument,
      sourceDocumentId: entity.sourceDocumentId,
      readGroups: [entity.createdBy],
      writeGroups: [entity.createdBy],
      createdBy: entity.createdBy,
      companyId: entity.companyId
    });

    uploaded.push(file.name);
  }

  return data({ uploaded, errors });
}
