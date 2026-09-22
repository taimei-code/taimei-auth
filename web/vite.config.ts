import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const appEnv = process.env.APP_ENV ?? "production";

// CI の docker job が image の APP_ENV をこの file で検証する (bundle の grep は minifier の出力に依存するため退けた)。dist は公開されるので env 名以外を入れない
const buildInfoPlugin = (): Plugin => ({
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
  plugins: [react(), buildInfoPlugin()],
  base: "/auth/",
  root: __dirname,
  // services.ts が APP_ENV=test で localhost を許可するため client bundle にも埋め込む
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
