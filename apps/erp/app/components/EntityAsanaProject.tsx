import type { AsanaProject, AsanaTask } from "@carbon/ee/asana";
import { SelectControlled } from "@carbon/form";
import { Button, HStack, toast, VStack } from "@carbon/react";
import { useEffect, useMemo, useState } from "react";
import { LuExternalLink, LuLink2Off } from "react-icons/lu";
import { useFetcher } from "react-router";
import { AsanaIcon } from "~/components/Icons";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import { path } from "~/utils/path";

type EntityType = "salesOrder" | "quote" | "salesRfq";

type Props = {
  entityType: EntityType;
  entityId: string;
  readableId: string;
  customerName: string;
  status: string;
  isDisabled?: boolean;
};

export const EntityAsanaProject = ({
  entityType,
  entityId,
  readableId,
  customerName,
  status,
  isDisabled
}: Props) => {
  const [linkedTask, setLinkedTask] = useState<AsanaTask | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>("");

  const linkFetcher = useAsyncFetcher<{ linkedTask: AsanaTask | null }>();
  const projectsFetcher = useAsyncFetcher<{ projects: AsanaProject[] }>();
  const actionFetcher = useFetcher();

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    linkFetcher.load(
      `${path.to.api.asanaEntity}?entityType=${entityType}&entityId=${entityId}`
    );
  }, [entityType, entityId]);

  useEffect(() => {
    if (linkFetcher.data?.linkedTask) {
      setLinkedTask(linkFetcher.data.linkedTask);
    }
  }, [linkFetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    if (!linkedTask) {
      projectsFetcher.load(path.to.api.asanaEntity);
    }
  }, [linkedTask]);

  const projects = useMemo(
    () =>
      (projectsFetcher.data?.projects ?? []).map((p) => ({
        label: p.name,
        value: p.gid
      })),
    [projectsFetcher.data?.projects]
  );

  useEffect(() => {
    if (actionFetcher.state === "idle" && actionFetcher.data) {
      const result = actionFetcher.data as {
        success: boolean;
        message?: string;
        task?: AsanaTask;
      };
      if (result.success) {
        if (result.task) {
          setLinkedTask(result.task);
          toast.success("Asana task created");
        } else {
          setLinkedTask(null);
          toast.success("Asana task unlinked");
        }
      } else if (result.message) {
        toast.error(result.message);
      }
    }
  }, [actionFetcher.state, actionFetcher.data]);

  const handleCreate = () => {
    if (!selectedProject) return;
    const formData = new FormData();
    formData.append("entityType", entityType);
    formData.append("entityId", entityId);
    formData.append("projectGid", selectedProject);
    formData.append("readableId", readableId);
    formData.append("customerName", customerName);
    formData.append("status", status);
    actionFetcher.submit(formData, {
      method: "post",
      action: path.to.api.asanaEntity
    });
  };

  const handleUnlink = () => {
    const formData = new FormData();
    formData.append("entityType", entityType);
    formData.append("entityId", entityId);
    actionFetcher.submit(formData, {
      method: "delete",
      action: path.to.api.asanaEntity
    });
  };

  if (linkedTask) {
    return (
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <HStack spacing={1}>
            <AsanaIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Asana Task
            </span>
          </HStack>
          <Button
            variant="ghost"
            size="sm"
            className="p-1"
            onClick={handleUnlink}
            isDisabled={isDisabled}
          >
            <LuLink2Off className="w-3 h-3" />
          </Button>
        </HStack>
        <a
          href={linkedTask.permalink_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          {linkedTask.name}
          <LuExternalLink className="w-3 h-3" />
        </a>
      </VStack>
    );
  }

  return (
    <VStack spacing={2}>
      <HStack spacing={1}>
        <AsanaIcon className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Asana Project
        </span>
      </HStack>
      <SelectControlled
        name="asanaProject"
        placeholder="Select a project"
        options={projects}
        value={selectedProject}
        onChange={(option) => {
          if (option) setSelectedProject(option.value);
        }}
        isReadOnly={isDisabled}
      />
      {selectedProject && (
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={handleCreate}
          isDisabled={isDisabled || actionFetcher.state !== "idle"}
        >
          Create Task
        </Button>
      )}
    </VStack>
  );
};
