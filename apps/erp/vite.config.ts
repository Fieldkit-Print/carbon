import { reactRouter } from "@react-router/dev/vite";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, PluginOption } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Workaround for react-router's cleanViteManifests crashing when
 * build/client/.vite doesn't exist after the SSR build phase.
 */
function ensureViteDir(): PluginOption {
  return {
    name: "ensure-vite-dir",
    closeBundle() {
      const viteDir = path.resolve(__dirname, "build/client/.vite");
      fs.mkdirSync(viteDir, { recursive: true });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  build: {
    minify: true,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (warning.code === "SOURCEMAP_ERROR") {
          return;
        }

        defaultHandler(warning);
      },
      ...(isSsrBuild && { input: "./server/app.ts" }),
    },
  },
  define: {
    global: "globalThis",
  },
  ssr: {
    noExternal: [
      "react-tweet",
      "react-dropzone",
      "react-icons",
      "react-phone-number-input",
      "tailwind-merge",
    ],
  },
  server: {
    port: 3000,
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev"],
  },
  plugins: [reactRouter(), tsconfigPaths(), ensureViteDir()] as PluginOption[],
  resolve: {
    alias: {
      "@carbon/utils": path.resolve(
        __dirname,
        "../../packages/utils/src/index.ts"
      ),
      "@carbon/form": path.resolve(
        __dirname,
        "../../packages/form/src/index.tsx"
      ),
    },
  },
}));
