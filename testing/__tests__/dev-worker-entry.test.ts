import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { grepFiles } from "../../src/__tests__/source-scan";

const DEV_WORKER_ENTRY = basename(fileURLToPath(new URL("../dev-worker.ts", import.meta.url)));

describe("フィーチャーフラグを wrangler の手元の置き場で評価する入口は、開発環境の compose だけが起動する", () => {
  test("その入口を名指しするのは docker-compose.yml だけで、e2e・試験用の image・CI の起動は名指ししない", () => {
    expect(
      grepFiles(
        DEV_WORKER_ENTRY,
        [
          ".github",
          "scripts",
          "e2e",
          "packages",
          "docker-compose.yml",
          "Dockerfile",
          "package.json",
          "playwright.config.ts",
        ],
        {
          include: ["*.sh", "*.yml", "*.yaml", "*.json", "*.jsonc", "*.ts", "Dockerfile"],
          tests: "exclude",
        },
      ),
    ).toEqual(["docker-compose.yml"]);
  });
});
