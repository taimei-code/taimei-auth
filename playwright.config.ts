import { defineConfig } from "@playwright/test";

const PORT = 3110;
const SPECS_SHARE_SERVER_LOG_AND_SEED = { fullyParallel: false, workers: 1 };
const SPECS_INJECTING_TEST_ONLY_INLINE_STYLE = /dialog-closing-back-navigation\.e2e\.ts$/;

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
  projects: [
    {
      name: "content-security-policy-enforced",
      testIgnore: SPECS_INJECTING_TEST_ONLY_INLINE_STYLE,
    },
    {
      name: "test-only-inline-style",
      testMatch: SPECS_INJECTING_TEST_ONLY_INLINE_STYLE,
      use: { bypassCSP: true },
    },
  ],
  webServer: {
    command: "bash e2e/start-server.sh",
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
