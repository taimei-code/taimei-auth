import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "tailwindcss";
import productionConfig, { PRODUCTION_CONTENT_GLOBS } from "../tailwind.config";

const nonProductionDir = path.dirname(fileURLToPath(import.meta.url));

const config: Config = {
  ...productionConfig,
  content: [...PRODUCTION_CONTENT_GLOBS, path.join(nonProductionDir, "**/*.tsx")],
};
export default config;
