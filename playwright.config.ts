import { defineConfig } from "@playwright/test";

// e2e はブラウザ実機でしか再現しない動線 (magic link 着地 / SessionGuard / 役割別 UI) の
// スモーク。compose の 3100 と衝突しない 3110 で専用サーバを立て、magic link は
// local 環境の console 出力 (e2e/.server.log) から取得する。
// spec は *.e2e.ts — *.test.ts / *.spec.ts にすると bun test が拾って二重実行になる。
const PORT = 3110;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  // magic link ログと seed データを全 spec が共有するため直列実行に固定する
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
