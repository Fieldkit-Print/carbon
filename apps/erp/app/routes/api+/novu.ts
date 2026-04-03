import { serve } from "@novu/framework/remix";
import {
  approvalWorkflow,
  assignmentWorkflow,
  digitalQuoteResponseWorkflow,
  expirationWorkflow,
  gaugeCalibrationExpiredWorkflow,
  jobCompletedWorkflow,
  messageWorkflow,
  reminderWorkflow,
  suggestionResponseWorkflow,
  supplierQuoteResponseWorkflow
} from "~/novu/workflows";

const handler = serve({
  workflows: [
    approvalWorkflow,
    assignmentWorkflow,
    digitalQuoteResponseWorkflow,
    expirationWorkflow,
    gaugeCalibrationExpiredWorkflow,
    jobCompletedWorkflow,
    messageWorkflow,
    reminderWorkflow,
    suggestionResponseWorkflow,
    supplierQuoteResponseWorkflow
  ]
});

export { handler as action, handler as loader };
