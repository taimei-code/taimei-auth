import { defineConfig } from "@playwright/test";

// spec は *.e2e.ts にする (*.test.ts や *.spec.ts だと bun test も拾って二重に実行される)
const PORT = 3110;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  // magic link のログと seed データを全 spec が共有するため直列
  fullyParallel: false,
  workers: 1,
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
