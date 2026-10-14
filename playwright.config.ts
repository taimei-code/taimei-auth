import { defineConfig } from "@playwright/test";

const PORT = 3110;
const SPECS_SHARE_SERVER_LOG_AND_SEED = { fullyParallel: false, workers: 1 };

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  ...SPECS_SHARE_SERVER_LOG_AND_SEED,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bash e2e/start-server.sh",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
