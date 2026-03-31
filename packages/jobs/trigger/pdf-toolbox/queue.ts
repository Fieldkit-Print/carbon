import { queue } from "@trigger.dev/sdk";

/** Shared concurrency-limited queue for all pdfToolbox operations */
export const pdfQueue = queue({
  name: "pdf-toolbox",
  concurrencyLimit: 1,
});
