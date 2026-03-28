import { tasks as triggerTasks } from "@trigger.dev/sdk";

const TRIGGER_ENABLED = !!process.env.TRIGGER_SECRET_KEY;

/**
 * A wrapper around Trigger.dev's `tasks` that gracefully no-ops
 * when TRIGGER_SECRET_KEY is not configured.
 */
export const tasks: typeof triggerTasks = {
  ...triggerTasks,
  trigger: async (...args: Parameters<typeof triggerTasks.trigger>) => {
    if (!TRIGGER_ENABLED) {
      console.warn(`[tasks] Trigger.dev not configured, skipping: ${args[0]}`);
      return { id: "noop" } as any;
    }
    return triggerTasks.trigger(...args);
  },
  batchTrigger: async (
    ...args: Parameters<typeof triggerTasks.batchTrigger>
  ) => {
    if (!TRIGGER_ENABLED) {
      console.warn(
        `[tasks] Trigger.dev not configured, skipping batch: ${args[0]}`
      );
      return { runs: [] } as any;
    }
    return triggerTasks.batchTrigger(...args);
  }
};
