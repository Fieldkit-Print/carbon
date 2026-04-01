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

enum UploadState {
  Valid,
  Expired,
  NotFound
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return { state: UploadState.NotFound, data: null };
  }

  const serviceRole = getCarbonServiceRole();
  const externalLink = await getExternalLink(serviceRole, id);

  if (externalLink.error || !externalLink.data) {
    return { state: UploadState.NotFound, data: null };
  }

  if (
    externalLink.data.expiresAt &&
    new Date(externalLink.data.expiresAt) < new Date()
  ) {
    return { state: UploadState.Expired, data: null };
  }

  const entity = await getEntityForUploadLink(
    serviceRole,
    externalLink.data.documentId
  );
  if (!entity) {
    return { state: UploadState.NotFound, data: null };
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
    state: UploadState.Valid,
    data: {
      externalLinkId: id,
      entityName: entity.entityName,
      sourceDocument: entity.sourceDocument,
      companyName: company.data?.name ?? "",
      logoLight: company.data?.logoLight ?? null,
      logoDark: company.data?.logoDark ?? null,
      customerName: customer?.data?.name ?? "",
      files: (files.data ?? []).filter(
        (f) => f.name !== ".emptyFolderPlaceholder"
      )
    }
  };
}

export default function UploadPage() {
  const { state, data } = useLoaderData<typeof loader>();

  if (state === UploadState.NotFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <Heading size="h4">Link Not Found</Heading>
            <p className="text-muted-foreground text-center">
              The upload link you're trying to access is not valid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === UploadState.Expired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-lg">
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

function UploadPageContent({
  externalLinkId,
  entityName,
  sourceDocument,
  companyName,
  logoLight,
  logoDark,
  customerName,
  files
}: NonNullable<Awaited<ReturnType<typeof loader>>["data"]>) {
  const mode = useMode();
  const logo = mode === "dark" ? logoDark : logoLight;
  const revalidator = useRevalidator();
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return;
      setUploading(true);

      const formData = new FormData();
      for (const file of acceptedFiles) {
        formData.append("files", file);
      }

      try {
        const response = await fetch(
          `/api/sales/client-upload/${externalLinkId}`,
          {
            method: "POST",
            body: formData
          }
        );

        const result = await response.json();

        if (result.error) {
          toast.error(result.error);
        } else {
          if (result.uploaded?.length) {
            toast.success(
              `Uploaded ${result.uploaded.length} file${result.uploaded.length > 1 ? "s" : ""}`
            );
          }
          if (result.errors?.length) {
            toast.error(`Failed to upload: ${result.errors.join(", ")}`);
          }
          revalidator.revalidate();
        }
      } catch {
        toast.error("Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [externalLinkId, revalidator]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    disabled: uploading
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
      <Card className="w-full max-w-2xl">
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
