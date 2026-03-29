import { aptGet } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";

config();

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID!,
  maxDuration: 300,
  runtime: "node",
  logLevel: "log",
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./trigger"],
  build: {
    extensions: [
      // Required by pdf-to-img's canvas dependency for PDF thumbnail rendering
      aptGet({
        packages: [
          "libcairo2-dev",
          "libpango1.0-dev",
          "libjpeg-dev",
          "libgif-dev",
          "librsvg2-dev",
        ],
      }),
    ],
  },
});
