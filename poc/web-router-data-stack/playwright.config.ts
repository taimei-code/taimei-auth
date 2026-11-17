import { defineConfig } from "@playwright/test";

const app = process.env.APP ?? "tsr-atom";
const servesBuild = process.env.SERVE === "static";
const port = servesBuild ? 5198 : 5199;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: servesBuild ? `APP=${app} bun serve.ts` : `APP=${app} ./node_modules/.bin/vite --config vite.config.ts`,
    url: `http://localhost:${port}/auth/`,
    reuseExistingServer: false,
  },
});
