import { defineConfig } from "@playwright/test";

// e2e は、実際のブラウザでしか再現しない動線 (magic link の着地、SessionGuard、役割別の UI) の
// スモークテストである。compose の 3100 と衝突しない 3110 で専用のサーバを立て、magic link は
// local 環境の console 出力 (e2e/.server.log) から取得する。
// spec のファイル名は *.e2e.ts にする。*.test.ts や *.spec.ts にすると bun test が拾って二重に実行される。
const PORT = 3110;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  // magic link のログと seed データを全 spec が共有するため、直列実行に固定する
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
