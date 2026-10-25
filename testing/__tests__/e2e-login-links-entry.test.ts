import { describe, expect, test } from "bun:test";
import { grepFiles } from "../../src/__tests__/source-scan";
import { E2E_LOGIN_LINKS_DEFINE, e2eLoginLinksEnabled } from "../e2e-login-links";

describe("ログイン URL の試験 API は、taimei-auth 自身の e2e の起動の時だけ載る", () => {
  test("e2e の起動 script が渡す build の定数が無ければ、載せない", () => {
    expect(e2eLoginLinksEnabled()).toBe(false);
  });

  test("その定数の名前が出るのは、e2e の起動 script と定数を読む module だけ", () => {
    expect(
      grepFiles(
        E2E_LOGIN_LINKS_DEFINE,
        [
          ".github",
          "scripts",
          "e2e",
          "testing",
          "packages",
          "docker-compose.yml",
          "Dockerfile",
          "package.json",
        ],
        {
          include: ["*.sh", "*.yml", "*.yaml", "*.json", "*.jsonc", "*.ts", "Dockerfile"],
        },
      ),
    ).toEqual(["e2e/start-server.sh", "testing/e2e-login-links.ts"]);
  });
});
