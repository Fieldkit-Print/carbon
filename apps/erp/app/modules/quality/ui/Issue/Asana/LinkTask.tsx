import type { AsanaTask } from "@carbon/ee/asana";
import { Hidden, Submit, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  cn,
  Input,
  ModalFooter,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  useDebounce,
  VStack
} from "@carbon/react";
import { useId, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import z from "zod";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import type { IssueActionTask } from "~/modules/quality";
import { path } from "~/utils/path";

type Props = {
  task: IssueActionTask;
  linked?: AsanaTask;
  onClose: () => void;
};

const linkTaskValidator = z.object({
  actionId: z.string(),
  taskGid: z.string()
});

export const LinkTask = (props: Props) => {
  const id = useId();
  const [taskGid, setTaskGid] = useState<string | undefined>();

  const { tasks, fetcher } = useAsanaTasks();

  const onSearch = useDebounce((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value || e.target.value.trim().length < 3) return;

    fetcher.load(
      path.to.api.asanaLinkExistingTask +
        `?actionId=${props.task.id}&search=${e.target.value}`
    );
  }, 300);

  const isSearching = fetcher.state === "loading";

  return (
    <ValidatedForm
      id={id}
      method="post"
      action={path.to.api.asanaLinkExistingTask}
      validator={linkTaskValidator}
      fetcher={fetcher}
      resetAfterSubmit
      onAfterSubmit={() => props.onClose()}
    >
      <Hidden name="actionId" value={props.task.id} />
      <Hidden name="taskGid" value={taskGid} />
      <VStack spacing={4}>
        <div className="w-full flex items-center gap-x-2 relative">
          <Input
            name="query"
            type="search"
            className="w-full"
            autoComplete="off"
            placeholder="Search by Asana task name..."
            onChange={onSearch}
            disabled={isSearching}
          />
          {isSearching && (
            <Spinner className="w-5 h-5 absolute right-3.5 text-primary animate-spin" />
          )}
        </div>
        <ToggleGroup
          orientation="vertical"
          onValueChange={setTaskGid}
          value={taskGid}
          type="single"
          className="w-full flex-col gap-y-2"
        >
          {tasks.map((task) => (
            <ToggleGroupItem
              key={task.gid}
              name="taskGid"
              value={task.gid}
              disabled={task.gid === props.linked?.gid}
              variant={"outline"}
              className={cn(
                "w-full rounded-lg p-3 text-left transition-colors hover:bg-transparent block h-auto data-[state=on]:bg-transparent hover:data-[state=on]:bg-transparent data-[state=on]:border-primary hover:data-[state=on]:border-primary"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 justify-between">
                    <Link
                      to={task.permalink_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center"
                    >
                      <span className="mr-2 text-foreground flex items-center">
                        {task.name}
                        <LuExternalLink className="size-4 ml-2 text-primary" />
                      </span>
                    </Link>

                    <Badge
                      variant={task.completed ? "green" : "outline"}
                      className="font-normal text-muted-foreground"
                    >
                      {task.completed ? "Completed" : "Open"}
                    </Badge>
                  </div>

                  <div className="mt-2 text-sm text-muted-foreground">
                    {task.assignee?.email
                      ? `Assigned to ${task.assignee.email}`
                      : "Unassigned"}
                  </div>
                </div>
              </div>
            </ToggleGroupItem>
          ))}

          {tasks.length === 0 && !isSearching && (
            <p className="text-sm text-muted-foreground">
              No Asana tasks found
            </p>
          )}
        </ToggleGroup>
      </VStack>
      <ModalFooter>
        <Button
          variant="secondary"
          onClick={() => {
            props.onClose();
          }}
        >
          Cancel
        </Button>
        <Submit>Save</Submit>
      </ModalFooter>
    </ValidatedForm>
  );
};

LinkTask.displayName = "LinkTask";

const useAsanaTasks = () => {
  const fetcher = useAsyncFetcher<{
    tasks: AsanaTask[];
  }>();

  return {
    tasks: fetcher.data?.tasks || [],
    fetcher
  };
};
