import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = process.env.APP ?? "tsr-atom";

// ADR-0002 の SPA fallback (/account/* に index.html) を dev server でも再現する
const accountFallback = (): Plugin => ({
  name: "account-fallback",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith("/account")) req.url = "/auth/";
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), accountFallback()],
  base: "/auth/",
  root: path.join(here, "apps", app),
  define: { "process.env.APP_ENV": JSON.stringify("test") },
  resolve: { alias: { "@core": path.resolve(here, "../../src") } },
  build: { outDir: path.join(here, "dist", app), emptyOutDir: true },
  server: { port: 5199, strictPort: true },
});
