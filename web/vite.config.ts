import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const appEnv = process.env.APP_ENV ?? "production";

const publicBuildInfoPlugin = (): Plugin => ({
  name: "taimei-build-info",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "build-info.json",
      source: JSON.stringify({ appEnv }),
    });
  },
});

export default defineConfig({
  plugins: [react(), publicBuildInfoPlugin()],
  base: "/auth/",
  root: __dirname,
  define: {
    "process.env.APP_ENV": JSON.stringify(appEnv),
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
  },
  server: {
    port: 5173,
  },
});
