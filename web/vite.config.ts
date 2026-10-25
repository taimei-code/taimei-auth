import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { WEB_BASE_PATH } from "./web-base-path";

export default defineConfig({
  plugins: [react()],
  base: WEB_BASE_PATH,
  root: __dirname,
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
