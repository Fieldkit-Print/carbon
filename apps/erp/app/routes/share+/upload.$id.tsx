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

const MAX_FILE_SIZE_MB = 1024;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      resolve(xhr.status >= 200 && xhr.status < 300);
    });

    xhr.addEventListener("error", () => resolve(false));
    xhr.addEventListener("abort", () => resolve(false));

    xhr.send(file);
  });
}

interface UploadProgress {
  fileName: string;
  percent: number;
  status: "uploading" | "done" | "error";
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
  const [progress, setProgress] = useState<UploadProgress[]>([]);

  const uploadFile = useCallback(
    async (
      file: File,
      onProgress: (percent: number) => void
    ): Promise<boolean> => {
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

      // 2. Upload directly to Supabase Storage with progress
      const success = await uploadWithProgress(
        signData.signedUrl,
        file,
        onProgress
      );

      if (!success) {
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
      setProgress(
        acceptedFiles.map((f) => ({
          fileName: f.name,
          percent: 0,
          status: "uploading" as const
        }))
      );

      const uploaded: string[] = [];
      const errors: string[] = [];

      for (let i = 0; i < acceptedFiles.length; i++) {
        const file = acceptedFiles[i];
        if (file.size > MAX_FILE_SIZE_BYTES) {
          toast.error(
            `${file.name} exceeds the ${MAX_FILE_SIZE_MB}MB file size limit`
          );
          setProgress((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, status: "error" as const } : p
            )
          );
          continue;
        }

        try {
          const success = await uploadFile(file, (percent) => {
            setProgress((prev) =>
              prev.map((p, idx) => (idx === i ? { ...p, percent } : p))
            );
          });
          if (success) {
            uploaded.push(file.name);
            setProgress((prev) =>
              prev.map((p, idx) =>
                idx === i ? { ...p, percent: 100, status: "done" as const } : p
              )
            );
          } else {
            errors.push(file.name);
            setProgress((prev) =>
              prev.map((p, idx) =>
                idx === i ? { ...p, status: "error" as const } : p
              )
            );
          }
        } catch {
          errors.push(file.name);
          setProgress((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, status: "error" as const } : p
            )
          );
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
      setTimeout(() => setProgress([]), 2000);
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
                    Max file size: 1GB
                  </p>
                )}
              </VStack>
            </div>

            {progress.length > 0 && (
              <VStack spacing={2} className="w-full">
                {progress.map((p) => (
                  <div key={p.fileName} className="w-full">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm truncate mr-4">
                        {p.fileName}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {p.status === "done"
                          ? "Complete"
                          : p.status === "error"
                            ? "Failed"
                            : `${p.percent}%`}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          p.status === "error"
                            ? "bg-destructive"
                            : p.status === "done"
                              ? "bg-green-500"
                              : "bg-primary"
                        }`}
                        style={{ width: `${p.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </VStack>
            )}

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
