import { AsanaTaskSchema } from "@carbon/ee/asana";
import {
  Badge,
  Button,
  cn,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useDisclosure
} from "@carbon/react";
import { useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import { PiLinkBreak } from "react-icons/pi";
import { Link, useRevalidator } from "react-router";
import { AsanaIcon } from "~/components/Icons";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import type { IssueActionTask } from "~/modules/quality/types";
import { path } from "~/utils/path";
import { CreateTask } from "./CreateTask";
import { LinkTask } from "./LinkTask";

interface Props {
  task: IssueActionTask;
}

export const AsanaIssueDialog = ({ task }: Props) => {
  const [tab, setTab] = useState("link");
  const revalidator = useRevalidator();

  const disclosure = useDisclosure({
    onClose() {
      revalidator.revalidate();
    }
  });

  const { data: linked } = AsanaTaskSchema.safeParse(task.asanaTask);
  const fetcher = useAsyncFetcher();

  const onUnlink = async () => {
    await fetcher.submit(
      { actionId: task.id },
      { method: "DELETE", action: path.to.api.asanaLinkExistingTask }
    );
    revalidator.revalidate();
  };

  const isAlreadyLinked = !!linked?.gid;

  return (
    <Modal
      open={disclosure.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          disclosure.onClose();
        }
      }}
    >
      <ModalTrigger onClick={() => disclosure.onToggle()}>
        {linked ? (
          <Button
            leftIcon={<AsanaIcon className={"size-4"} />}
            variant="ghost"
            aria-label="Update Asana task"
          >
            {linked.name.length > 30
              ? `${linked.name.slice(0, 30)}...`
              : linked.name}
          </Button>
        ) : (
          <IconButton
            icon={<AsanaIcon className={"size-4 grayscale"} />}
            variant="ghost"
            aria-label="Connect Asana task"
          />
        )}
      </ModalTrigger>
      <ModalContent size={"large"}>
        <Tabs value={tab} onValueChange={setTab} defaultValue="link">
          <ModalHeader className="mb-1 flex-row justify-between py-3">
            <div className="space-y-1">
              <ModalTitle>Link Asana Task</ModalTitle>
              <ModalDescription>
                Search for existing or create a new one
              </ModalDescription>
            </div>

            <TabsList className="max-w-max mb-4">
              <TabsTrigger value="link" disabled={isAlreadyLinked}>
                Link Existing
              </TabsTrigger>
              <TabsTrigger value="create" disabled={isAlreadyLinked}>
                Create New
              </TabsTrigger>
            </TabsList>
          </ModalHeader>
          <ModalBody>
            {linked && (
              <div
                className={cn(
                  "w-full rounded-lg p-3 mb-3 text-left transition-colors block h-auto border border-secondary"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 justify-between">
                      <Link
                        to={linked.permalink_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center"
                      >
                        <span className="mr-2 text-foreground flex items-center">
                          {linked.name}
                          <LuExternalLink className="size-4 ml-2 text-primary" />
                        </span>
                      </Link>

                      <div className="flex items-center gap-2">
                        <Badge
                          variant={linked.completed ? "green" : "outline"}
                          className="font-normal text-muted-foreground"
                        >
                          {linked.completed ? "Completed" : "Open"}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-2 text-sm text-muted-foreground flex justify-between items-center">
                      <span>
                        {linked.assignee?.email
                          ? `Assigned to ${linked.assignee.email}`
                          : "Unassigned"}
                      </span>

                      <Button
                        onClick={onUnlink}
                        isLoading={fetcher.state === "submitting"}
                        leftIcon={<PiLinkBreak />}
                        size="sm"
                        variant={"destructive"}
                      >
                        Unlink
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <TabsContent
              value="link"
              hidden={isAlreadyLinked}
              className="relative mt-0"
            >
              <LinkTask
                task={task}
                onClose={disclosure.onClose}
                linked={linked}
              />
            </TabsContent>
            <TabsContent value="create" className="relative mt-0">
              <CreateTask task={task} onClose={disclosure.onClose} />
            </TabsContent>
          </ModalBody>
        </Tabs>
      </ModalContent>
    </Modal>
  );
};
