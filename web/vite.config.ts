import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// taimei-auth Layer B (auth.taimei-code.com/auth/*) の Vite + React build pipeline。
// Hono の serveStatic で web/dist を配信する想定 (結線は PR2b)。
//
// base: "/auth/" 固定の理由 — Layer B は /auth/ 配下で動作し、Vite が生成する asset の
// URL (script/link の href) を /auth/assets/* に揃える必要がある。base を変更する場合は
// Hono 側 serveStatic の root も同じ prefix で配信する整合性を取ること。
//
// alias 二系統:
//   - "@/" → web/src/* (shadcn/ui CLI 標準)
//   - "@core/" → taimei-auth/src/* (services / sign-in-params 等の共有実装)

export default defineConfig({
  plugins: [react()],
  base: "/auth/",
  root: __dirname,
  // services.ts (URL allowlist) が APP_ENV=test 時に localhost を許可するため、
  // Vite bundle にも APP_ENV を埋め込む。これがないと client side で undefined。
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
