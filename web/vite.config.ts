import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { webBuildAppEnv } from "./build-app-env";
import { WEB_BASE_PATH } from "./web-base-path";

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
      "@taimei-auth/redirect-hosts": path.resolve(__dirname, "../src/redirect-hosts.ts"),
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
