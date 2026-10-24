import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Rollup } from "vite";
import productionConfig from "../vite.config";
import {
  NON_PRODUCTION_ENTRY_NAME,
  NON_PRODUCTION_SCRIPT_FILE,
  NON_PRODUCTION_STYLESHEET_FILE,
} from "./assets";

const nonProductionDir = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEFAULT_ASSET_FILE_NAMES = "assets/[name]-[hash][extname]";

const VITE_DEFAULT_ENTRY_FILE_NAMES = "assets/[name]-[hash].js";

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

export default mergeConfig(
  productionConfig,
  defineConfig({
    build: {
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          index: path.join(nonProductionDir, "../index.html"),
          [NON_PRODUCTION_ENTRY_NAME]: path.join(nonProductionDir, "main.tsx"),
        },
        output: nonProductionBuildOutput(),
      },
    },
  }),
);
