import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// taimei-auth Layer B (auth.taimei-code.com/auth/*) の Vite + React build pipeline。
// Hono の serveStatic で web/dist を配信する想定 (結線は PR2b)。
//
// base: "/auth/" 固定の理由 — Layer B は /auth/ 配下で動作し、Vite が生成する asset の
// URL (script/link の href) を /auth/assets/* に揃える必要がある。base を変更する場合は
// Hono 側 serveStatic の root も同じ prefix で配信する整合性を取ること。

export default defineConfig({
  plugins: [react()],
  base: "/auth/",
  root: __dirname,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
