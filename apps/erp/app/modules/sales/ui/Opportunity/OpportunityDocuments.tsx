import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  File,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { convertKbToString, formatDate } from "@carbon/utils";
import { useDndContext, useDraggable } from "@dnd-kit/core";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import {
  LuEllipsisVertical,
  LuGripVertical,
  LuRadioTower,
  LuShoppingCart,
  LuUpload
} from "react-icons/lu";
import { Outlet, useFetchers, useRevalidator, useSubmit } from "react-router";
import { DocumentPreview, FileDropzone } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { usePermissions, useUser } from "~/hooks";
import { getDocumentType } from "~/modules/shared";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import type { Opportunity } from "../../types";
import { useOptimisticDocumentDrag } from "../SalesRFQ/useOptimiticDocumentDrag";

interface UploadProgress {
  fileName: string;
  percent: number;
  status: "uploading" | "done" | "error";
}

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

type OpportunityDocumentsProps = {
  attachments: FileObject[];
  opportunity: Opportunity;
  id: string;
  type: "Sales Order" | "Request for Quote" | "Quote" | "Sales Invoice";
  isReadOnly?: boolean;
};

const OpportunityDocuments = ({
  attachments,
  opportunity,
  id,
  type,
  isReadOnly: isReadOnlyProp
}: OpportunityDocumentsProps) => {
  const { canDelete, download, deleteAttachment, getPath, upload } =
    useOpportunityDocuments({
      opportunityId: opportunity.id,
      id,
      type
    });
  const effectiveCanDelete = isReadOnlyProp ? false : canDelete;
  const [progress, setProgress] = useState<UploadProgress[]>([]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      upload(acceptedFiles, setProgress);
    },
    [upload]
  );

  const optimisticDrags = useOptimisticDocumentDrag();

  const attachmentsByName = new Map<string, FileObject | OptimisticFileObject>(
    attachments.map((file) => [file.name, file])
  );
  const pendingItems = usePendingItems();
  for (let pendingItem of pendingItems) {
    let item = attachmentsByName.get(pendingItem.name);
    let merged = item ? { ...item, ...pendingItem } : pendingItem;
    attachmentsByName.set(pendingItem.name, merged);
  }

  const attachmentsToRender = Array.from(attachmentsByName.values())
    .filter((d) => !optimisticDrags?.find((o) => o.id === d.id))
    .sort((a, b) => a.name.localeCompare(b.name)) as FileObject[];

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Files</CardTitle>
          </CardHeader>
          <CardAction>
            {!isReadOnlyProp && (
              <OpportunityDocumentForm
                opportunityId={opportunity.id}
                id={id}
                type={type}
                setProgress={setProgress}
              />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Size</Th>
                <Th>Created</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {attachmentsToRender.length ? (
                attachmentsToRender.map((attachment) => (
                  <Tr key={attachment.id}>
                    <DraggableCell
                      attachment={attachment}
                      opportunity={opportunity}
                      download={download}
                      getPath={getPath}
                    />
                    <Td className="text-xs font-mono">
                      {convertKbToString(
                        Math.floor((attachment.metadata?.size ?? 0) / 1024)
                      )}
                    </Td>
                    <Td className="text-xs font-mono">
                      {attachment.created_at
                        ? formatDate(attachment.created_at)
                        : "--"}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label="More"
                              icon={<LuEllipsisVertical />}
                              variant="secondary"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => download(attachment)}
                            >
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              destructive
                              disabled={!effectiveCanDelete}
                              onClick={() => deleteAttachment(attachment)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Td>
                  </Tr>
                ))
              ) : (
                <Tr>
                  <Td
                    colSpan={24}
                    className="py-8 text-muted-foreground text-center"
                  >
                    No files uploaded
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          {!isReadOnlyProp && <FileDropzone onDrop={onDrop} />}
          {progress.length > 0 && (
            <div className="mt-4 space-y-2">
              {progress.map((p) => (
                <div key={p.fileName}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm truncate mr-4">{p.fileName}</span>
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
            </div>
          )}
        </CardContent>
      </Card>

      <Outlet />
    </>
  );
};

const DraggableCell = ({
  attachment,
  opportunity,
  download,
  getPath
}: {
  attachment: FileObject;
  opportunity: Opportunity;
  download: (attachment: FileObject) => void;
  getPath: (attachment: FileObject) => string;
}) => {
  const context = useDndContext();
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: attachment.id,
    data: {
      id: attachment.id,
      name: attachment.name,
      size: attachment.metadata?.size || 0,
      path: getPath(attachment),
      type: "opportunityDocument"
    }
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 1000
      }
    : undefined;

  const isPreviewable = ["PDF", "Image"].includes(
    getDocumentType(attachment.name)
  );

  return (
    <Td ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <HStack>
        {context.droppableContainers.size > 0 && (
          <LuGripVertical className="w-4 h-4 flex-shrink-0" />
        )}
        <DocumentIcon type={getDocumentType(attachment.name)} />
        <span
          className="font-medium cursor-pointer"
          onClick={() => {
            if (isPreviewable) {
              window.open(
                path.to.file.previewFile(`private/${getPath(attachment)}`),
                "_blank"
              );
            } else {
              download(attachment);
            }
          }}
        >
          {isPreviewable ? (
            <DocumentPreview
              bucket="private"
              pathToFile={getPath(attachment)}
              // @ts-ignore
              type={getDocumentType(attachment.name)}
            >
              {attachment.name}
            </DocumentPreview>
          ) : (
            attachment.name
          )}
        </span>
        {opportunity?.purchaseOrderDocumentPath === getPath(attachment) && (
          <Badge variant="secondary">
            <LuShoppingCart />
          </Badge>
        )}
        {opportunity?.requestForQuoteDocumentPath === getPath(attachment) && (
          <Badge variant="secondary">
            <LuRadioTower />
          </Badge>
        )}
      </HStack>
    </Td>
  );
};

type OpportunityDocumentFormProps = {
  opportunityId: string;
  id: string;
  type: "Sales Order" | "Request for Quote" | "Quote" | "Sales Invoice";
  setProgress?: Dispatch<SetStateAction<UploadProgress[]>>;
};

export const useOpportunityDocuments = ({
  id,
  opportunityId,
  type
}: OpportunityDocumentFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();
  const revalidator = useRevalidator();
  const submit = useSubmit();

  const canDelete = permissions.can("delete", "sales"); // TODO: or is document owner

  const getPath = useCallback(
    (attachment: { name: string }) => {
      return `${
        company.id
      }/opportunity/${opportunityId}/${stripSpecialCharacters(
        attachment.name
      )}`;
    },
    [company.id, opportunityId]
  );

  const deleteAttachment = useCallback(
    async (attachment: FileObject) => {
      const result = await carbon?.storage
        .from("private")
        .remove([getPath(attachment)]);

      if (!result || result.error) {
        toast.error(result?.error?.message || "Error deleting file");
        return;
      }

      toast.success(`${attachment.name} deleted successfully`);
      revalidator.revalidate();
    },
    [carbon?.storage, getPath, revalidator]
  );

  const download = useCallback(
    async (attachment: FileObject) => {
      const url = path.to.file.previewFile(`private/${getPath(attachment)}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = attachment.name;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error("Error downloading file");
        console.error(error);
      }
    },
    [getPath]
  );

  const createDocumentRecord = useCallback(
    ({
      path: filePath,
      name,
      size
    }: {
      path: string;
      name: string;
      size: number;
    }) => {
      const formData = new FormData();
      formData.append("path", filePath);
      formData.append("name", name);
      formData.append("size", Math.round(size / 1024).toString());
      formData.append("sourceDocument", type);
      formData.append("sourceDocumentId", id);

      submit(formData, {
        method: "post",
        action: path.to.newDocument,
        navigate: false,
        fetcherKey: `opportunity:${name}`
      });
    },
    [id, submit, type]
  );

  const upload = useCallback(
    async (
      files: File[],
      setProgress?: Dispatch<SetStateAction<UploadProgress[]>>
    ) => {
      if (!carbon) {
        toast.error("Carbon client not available");
        return;
      }

      setProgress?.(
        files.map((f) => ({
          fileName: f.name,
          percent: 0,
          status: "uploading" as const
        }))
      );

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const storagePath = getPath(file);

        try {
          // Create a signed upload URL for XHR progress tracking
          const { data: signedUrl, error: signError } = await carbon.storage
            .from("private")
            .createSignedUploadUrl(storagePath, { upsert: true });

          if (signError || !signedUrl) {
            toast.error(`Failed to upload file: ${file.name}`);
            setProgress?.((prev) =>
              prev.map((p, idx) =>
                idx === i ? { ...p, status: "error" as const } : p
              )
            );
            continue;
          }

          const success = await uploadWithProgress(
            signedUrl.signedUrl,
            file,
            (percent) => {
              setProgress?.((prev) =>
                prev.map((p, idx) => (idx === i ? { ...p, percent } : p))
              );
            }
          );

          if (success) {
            setProgress?.((prev) =>
              prev.map((p, idx) =>
                idx === i ? { ...p, percent: 100, status: "done" as const } : p
              )
            );
            createDocumentRecord({
              path: storagePath,
              name: file.name,
              size: file.size
            });
          } else {
            toast.error(`Failed to upload file: ${file.name}`);
            setProgress?.((prev) =>
              prev.map((p, idx) =>
                idx === i ? { ...p, status: "error" as const } : p
              )
            );
          }
        } catch {
          toast.error(`Failed to upload file: ${file.name}`);
          setProgress?.((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, status: "error" as const } : p
            )
          );
        }
      }

      revalidator.revalidate();
      setTimeout(() => setProgress?.([]), 2000);
    },
    [getPath, createDocumentRecord, carbon, revalidator]
  );

  return {
    canDelete,
    deleteAttachment,
    download,
    upload,
    getPath
  };
};

const OpportunityDocumentForm = (props: OpportunityDocumentFormProps) => {
  const { company } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const { upload } = useOpportunityDocuments(props);

  const uploadFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon && company) {
      upload(Array.from(e.target.files), props.setProgress);
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", "sales")}
      leftIcon={<LuUpload />}
      onChange={uploadFiles}
      multiple
    >
      New
    </File>
  );
};

export default OpportunityDocuments;

type OptimisticFileObject = Omit<
  FileObject,
  "owner" | "updated_at" | "created_at" | "last_accessed_at" | "buckets"
>;
export const usePendingItems = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.newDocument;
    })
    .reduce<OptimisticFileObject[]>((acc, fetcher) => {
      const path = fetcher.formData.get("path") as string;
      const name = fetcher.formData.get("name") as string;
      const size = parseInt(fetcher.formData.get("size") as string, 10) * 1024;

      if (path && name && size) {
        const newItem: OptimisticFileObject = {
          id: path,
          name: name,
          bucket_id: "private",
          metadata: {
            size,
            mimetype: getDocumentType(name)
          }
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};
