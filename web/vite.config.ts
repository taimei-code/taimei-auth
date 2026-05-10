import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 共通画面 SPA の Vite + React build。配信ポリシーは docs/adr/0002-spa-routing-and-static-assets.md 参照。
// alias: "@/" → web/src (shadcn/ui 標準), "@core/" → taimei-auth/src (auth ホストとの共有実装)

export default defineConfig({
  plugins: [react()],
  base: "/auth/",
  root: __dirname,
  // services.ts (URL allowlist) が APP_ENV=test 時に localhost を許可するため client bundle にも埋め込む
  define: {
    "process.env.APP_ENV": JSON.stringify(process.env.APP_ENV ?? "production"),
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
