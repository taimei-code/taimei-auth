import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// 共通画面 SPA の Vite + React build。配信ポリシーは docs/adr/0002-spa-routing-and-static-assets.md 参照。
// alias: "@/" → web/src (shadcn/ui 標準), "@core/" → taimei-auth/src (auth ホストとの共有実装)

const appEnv = process.env.APP_ENV ?? "production";

// dist がどの APP_ENV で build されたかを CI (docker job) が image の中身から検証するための成果物。
// minify 後 bundle の grep は minifier の出力形状に結合し無害な並べ替えで marker が消えるため、
// 検証点を意図した artifact 側に置く。dist は静的配信されるので公開可能な env 名以外は足さない。
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
  // services.ts (URL allowlist) が APP_ENV=test 時に localhost を許可するため client bundle にも埋め込む
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
