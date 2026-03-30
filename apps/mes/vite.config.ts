import { reactRouter } from "@react-router/dev/vite";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, PluginOption } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Workaround for react-router crashing when build/client/.vite
 * doesn't exist after the SSR build phase. Ensures the directory
 * exists at every build lifecycle hook.
 */
function ensureViteDir(): PluginOption {
  const ensure = () => {
    const viteDir = path.resolve(__dirname, "build/client/.vite");
    fs.mkdirSync(viteDir, { recursive: true });
  };
  return {
    name: "ensure-vite-dir",
    enforce: "post",
    buildStart: ensure,
    writeBundle: ensure,
    closeBundle: ensure,
  };
}

export default defineConfig(({ mode, isSsrBuild }) => ({
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
      "react-dropzone",
      "react-icons",
      "react-phone-number-input",
      "tailwind-merge",
    ],
  },
  server: {
    port: 3001,
    allowedHosts: [".ngrok-free.app", ".w.modal.host", ".w.modal.dev"],
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
