import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { convertKbToString, formatDate } from "@carbon/utils";
import type { FileObject } from "@supabase/storage-js";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload, LuFile, LuLoaderCircle } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { getCustomer, getEntityForUploadLink } from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getExternalLink } from "~/modules/shared";

export const meta = () => {
  return [{ title: "Upload Files" }];
};

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return { state: "not-found" as const, data: null };
  }

  const serviceRole = getCarbonServiceRole();
  const externalLink = await getExternalLink(serviceRole, id);

  if (externalLink.error || !externalLink.data) {
    return { state: "not-found" as const, data: null };
  }

  if (
    externalLink.data.expiresAt &&
    new Date(externalLink.data.expiresAt) < new Date()
  ) {
    return { state: "expired" as const, data: null };
  }

  const entity = await getEntityForUploadLink(
    serviceRole,
    externalLink.data.documentId
  );
  if (!entity) {
    return { state: "not-found" as const, data: null };
  }

  const [company, customer, files] = await Promise.all([
    getCompany(serviceRole, entity.companyId),
    externalLink.data.customerId
      ? getCustomer(serviceRole, externalLink.data.customerId)
      : null,
    serviceRole.storage
      .from("private")
      .list(`${entity.companyId}/opportunity/${entity.opportunityId}`)
  ]);

  return {
    state: "valid" as const,
    data: {
      externalLinkId: id,
      entityName: entity.entityName,
      sourceDocument: entity.sourceDocument,
      companyName: company.data?.name ?? "",
      logoLight: company.data?.logoLight ?? null,
      logoDark: company.data?.logoDark ?? null,
      customerName: customer?.data?.name ?? "",
      files: (files.data ?? []).filter(
        (f: FileObject) => f.name !== ".emptyFolderPlaceholder"
      )
    }
  };
}

export default function UploadPage() {
  const { state, data } = useLoaderData<typeof loader>();

  if (state === "not-found") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Heading size="h4">Link Not Found</Heading>
            <p className="text-muted-foreground text-center">
              The upload link you&apos;re trying to access is not valid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Heading size="h4">Link Expired</Heading>
            <p className="text-muted-foreground text-center">
              This upload link has expired. Please contact us for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return <UploadPageContent {...data} />;
}

const MAX_FILE_SIZE_MB = 200;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function UploadPageContent({
  externalLinkId,
  entityName,
  sourceDocument,
  companyName,
  logoLight,
  logoDark,
  customerName,
  files
}: {
  externalLinkId: string;
  entityName: string;
  sourceDocument: string;
  companyName: string;
  logoLight: string | null;
  logoDark: string | null;
  customerName: string;
  files: FileObject[];
}) {
  const mode = useMode();
  const logo = mode === "dark" ? logoDark : logoLight;
  const revalidator = useRevalidator();
  const [uploading, setUploading] = useState(false);

  const uploadFile = useCallback(
    async (file: File): Promise<boolean> => {
      // 1. Get signed upload URL
      const signForm = new FormData();
      signForm.set("intent", "sign");
      signForm.set("fileName", file.name);

      const signRes = await fetch(
        `/api/sales/client-upload/${externalLinkId}`,
        { method: "POST", body: signForm }
      );
      const signData = await signRes.json();

      if (signData.error || !signData.signedUrl) {
        return false;
      }

      // 2. Upload directly to Supabase Storage
      const uploadRes = await fetch(signData.signedUrl, {
        method: "PUT",
        headers: {
          "x-upsert": "true"
        },
        body: file
      });

      if (!uploadRes.ok) {
        return false;
      }

      // 3. Record the document
      const recordForm = new FormData();
      recordForm.set("intent", "record");
      recordForm.set("fileName", file.name);
      recordForm.set("fileSize", String(file.size));
      recordForm.set("storagePath", signData.storagePath);

      await fetch(`/api/sales/client-upload/${externalLinkId}`, {
        method: "POST",
        body: recordForm
      });

      return true;
    },
    [externalLinkId]
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return;
      setUploading(true);

      const uploaded: string[] = [];
      const errors: string[] = [];

      for (const file of acceptedFiles) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          toast.error(
            `${file.name} exceeds the ${MAX_FILE_SIZE_MB}MB file size limit`
          );
          continue;
        }

        try {
          const success = await uploadFile(file);
          if (success) {
            uploaded.push(file.name);
          } else {
            errors.push(file.name);
          }
        } catch {
          errors.push(file.name);
        }
      }

      if (uploaded.length) {
        toast.success(
          `Uploaded ${uploaded.length} file${uploaded.length > 1 ? "s" : ""}`
        );
      }
      if (errors.length) {
        toast.error(`Failed to upload: ${errors.join(", ")}`);
      }

      revalidator.revalidate();
      setUploading(false);
    },
    [uploadFile, revalidator]
  );

  const onDropRejected = useCallback(
    (fileRejections: Array<{ file: File }>) => {
      for (const { file } of fileRejections) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          toast.error(
            `${file.name} exceeds the ${MAX_FILE_SIZE_MB}MB file size limit`
          );
        }
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    multiple: true,
    disabled: uploading,
    maxSize: MAX_FILE_SIZE_BYTES
  });

  const entityLabel =
    sourceDocument === "Quote"
      ? "Quote"
      : sourceDocument === "Sales Order"
        ? "Sales Order"
        : "RFQ";

  return (
    <VStack spacing={8} className="w-full items-center p-2 md:p-8">
      {logo && (
        <img
          src={logo}
          alt={companyName}
          className="w-auto mx-auto max-w-5xl"
        />
      )}
      <Card className="w-full max-w-5xl mx-auto">
        <CardHeader>
          <VStack spacing={1}>
            <CardTitle>{companyName}</CardTitle>
            <HStack spacing={2}>
              <Badge variant="outline">{entityLabel}</Badge>
              <span className="text-sm text-muted-foreground">
                {entityName}
              </span>
              {customerName && (
                <span className="text-sm text-muted-foreground">
                  &mdash; {customerName}
                </span>
              )}
            </HStack>
          </VStack>
        </CardHeader>
        <CardContent>
          <VStack spacing={6}>
            <div
              {...getRootProps()}
              className={`w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? "border-primary bg-primary/10"
                  : "border-muted-foreground/25 hover:border-primary hover:bg-primary/5"
              } ${uploading ? "pointer-events-none opacity-50" : ""}`}
            >
              <input {...getInputProps()} />
              <VStack spacing={2} className="items-center">
                {uploading ? (
                  <LuLoaderCircle className="h-10 w-10 text-muted-foreground animate-spin" />
                ) : (
                  <LuCloudUpload className="h-10 w-10 text-muted-foreground" />
                )}
                <p className="text-sm font-medium">
                  {uploading
                    ? "Uploading..."
                    : isDragActive
                      ? "Drop files here"
                      : "Drag & drop files here, or click to browse"}
                </p>
                {!uploading && (
                  <p className="text-xs text-muted-foreground">
                    Max file size: {MAX_FILE_SIZE_MB}MB
                  </p>
                )}
              </VStack>
            </div>

            {files.length > 0 && (
              <VStack spacing={2} className="w-full">
                <Heading size="h5">Uploaded Files</Heading>
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
                      <Th>Size</Th>
                      <Th>Uploaded</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {files.map((file: FileObject) => (
                      <Tr key={file.id}>
                        <Td>
                          <HStack spacing={2}>
                            <LuFile className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm truncate">
                              {file.name}
                            </span>
                          </HStack>
                        </Td>
                        <Td>
                          <span className="text-sm text-muted-foreground">
                            {file.metadata?.size
                              ? convertKbToString(
                                  Math.ceil(file.metadata.size / 1024)
                                )
                              : "—"}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-sm text-muted-foreground">
                            {file.created_at
                              ? formatDate(file.created_at)
                              : "—"}
                          </span>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </VStack>
            )}
          </VStack>
        </CardContent>
      </Card>
    </VStack>
  );
}
