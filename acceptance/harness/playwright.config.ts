import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "..",
  testMatch: "**/*.browser.ts",
  globalSetup: "./build-web.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { timezoneId: "Asia/Tokyo", locale: "ja-JP" },
});
