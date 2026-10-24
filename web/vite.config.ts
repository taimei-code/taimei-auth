import path from "node:path";
import { defineConfig, type Plugin, type Rollup } from "vite";
import react from "@vitejs/plugin-react";
import { isProductionWebBuild, webBuildAppEnv } from "./build-app-env";
import {
  NON_PRODUCTION_ENTRY_NAME,
  NON_PRODUCTION_SCRIPT_FILE,
  NON_PRODUCTION_STYLESHEET_FILE,
  WEB_BASE_PATH,
} from "./non-production/assets";

const VITE_DEFAULT_ASSET_FILE_NAMES = "assets/[name]-[hash][extname]";

const VITE_DEFAULT_ENTRY_FILE_NAMES = "assets/[name]-[hash].js";

const publicBuildInfoPlugin = (): Plugin => ({
  name: "taimei-build-info",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "build-info.json",
      source: JSON.stringify({ appEnv: webBuildAppEnv }),
    });
  },
});

const nonProductionBuildOutput = (): Rollup.OutputOptions => ({
  entryFileNames: (chunk) =>
    chunk.name === NON_PRODUCTION_ENTRY_NAME
      ? NON_PRODUCTION_SCRIPT_FILE
      : VITE_DEFAULT_ENTRY_FILE_NAMES,
  assetFileNames: (asset) =>
    asset.names.some((name) => name.endsWith(".css"))
      ? NON_PRODUCTION_STYLESHEET_FILE
      : VITE_DEFAULT_ASSET_FILE_NAMES,
});

export default defineConfig({
  plugins: [react(), publicBuildInfoPlugin()],
  base: WEB_BASE_PATH,
  root: __dirname,
  define: {
    "process.env.APP_ENV": JSON.stringify(webBuildAppEnv),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@core": path.resolve(__dirname, "../src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    ...(isProductionWebBuild
      ? {}
      : {
          cssCodeSplit: false,
          rollupOptions: {
            input: {
              index: path.join(__dirname, "index.html"),
              [NON_PRODUCTION_ENTRY_NAME]: path.join(__dirname, "non-production/main.tsx"),
            },
            output: nonProductionBuildOutput(),
          },
        }),
  },
  server: {
    port: 5173,
  },
});
