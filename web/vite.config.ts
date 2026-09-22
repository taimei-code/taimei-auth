import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// 共通画面 SPA の Vite + React build。配信ポリシーは docs/adr/0002-spa-routing-and-static-assets.md を参照。
// alias は "@/" が web/src (shadcn/ui の標準)、"@core/" が taimei-auth/src (auth ホストと共有する実装)。

const appEnv = process.env.APP_ENV ?? "production";

// dist がどの APP_ENV で build されたかを、CI (docker job) が image の中身から検証するための成果物。
// minify 後の bundle を grep する方法は minifier の出力の形に依存し、無害な並べ替えでも marker が消えるため、
// 検証点を意図して用意した artifact 側に置く。dist は静的配信されるので、公開できる env 名以外は入れない。
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
  // services.ts (URL の allowlist) が APP_ENV=test の時に localhost を許可するため、client bundle にも埋め込む
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
