import type { AsanaUser } from "@carbon/ee/asana";
import {
  Hidden,
  Input,
  Select,
  Submit,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import { Button, ModalFooter, VStack } from "@carbon/react";
import { useEffect, useId, useMemo } from "react";
import z from "zod";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import type { IssueActionTask } from "~/modules/quality";
import { path } from "~/utils/path";

type Props = {
  task: IssueActionTask;
  onClose: () => void;
};

const createTaskValidator = z.object({
  actionId: z.string(),
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required")
});

export const CreateTask = (props: Props) => {
  const id = useId();

  const { members, fetcher } = useAsanaMembers();

  const membersOptions = useMemo(
    () => members.map((el) => ({ label: el.email, value: el.gid })),
    [members]
  );

  return (
    <ValidatedForm
      id={id}
      method="post"
      action={path.to.api.asanaCreateTask}
      validator={createTaskValidator}
      fetcher={fetcher}
      resetAfterSubmit
      onAfterSubmit={() => props.onClose()}
    >
      <VStack spacing={4}>
        <Hidden name="actionId" value={props.task.id} />
        <Input label="Name" name="name" placeholder="Task name" required />
        <TextArea
          label="Description"
          name="description"
          placeholder="Task description"
          required
        />
        <Select
          label="Assign To"
          name="assignee"
          placeholder="Select an assignee"
          isOptional
          options={membersOptions}
        />
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
        <Submit>Create</Submit>
      </ModalFooter>
    </ValidatedForm>
  );
};

CreateTask.displayName = "CreateTask";

const useAsanaMembers = () => {
  const fetcher = useAsyncFetcher<{
    members: AsanaUser[];
  }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    fetcher.load(path.to.api.asanaCreateTask);
  }, []);

  return {
    members: fetcher.data?.members || [],
    fetcher
  };
};
