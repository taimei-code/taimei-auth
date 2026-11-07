import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { foldkit } from "@foldkit/vite-plugin";
import { WEB_BASE_PATH } from "./web-base-path";

const webDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), foldkit({ devToolsMcpPort: false })],
  base: WEB_BASE_PATH,
  root: webDir,
  resolve: {
    alias: {
      "@": path.resolve(webDir, "./src"),
      "@core": path.resolve(webDir, "../src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
