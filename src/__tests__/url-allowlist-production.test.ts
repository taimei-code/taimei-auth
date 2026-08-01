import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// allowedHostPattern は module ロード時に APP_ENV で確定するため、production 値の検証は
// APP_ENV=production を注入した子プロセスで行う (テストプロセス全体を production 化すると
// rate-limit 等の local 緩和が外れ他テストが壊れる)。

const REPO_ROOT = join(import.meta.dir, "..", "..");

const CHECK_SCRIPT = `
import { validateRedirectUrl } from "./src/url-allowlist";
const results = {
  prodApp: validateRedirectUrl("https://app.taimei-code.com/", "taimei"),
  prodAuth: validateRedirectUrl("https://auth.taimei-code.com/account", "accounts"),
  localHostname: validateRedirectUrl("http://auth.taimei-code.local:3100/account", "accounts"),
  localhost: validateRedirectUrl("http://localhost:3100/account", "accounts"),
};
console.log(JSON.stringify(results));
`;

describe("allowlist の production 値 (子プロセスで APP_ENV=production)", () => {
  test(".taimei-code.local / localhost が拒否され .taimei-code.com のみ許可される", () => {
    const proc = Bun.spawnSync(["bun", "-e", CHECK_SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, APP_ENV: "production" },
    });

    expect(proc.exitCode).toBe(0);
    const results = JSON.parse(proc.stdout.toString().trim().split("\n").at(-1) ?? "{}");
    expect(results).toEqual({
      prodApp: true,
      prodAuth: true,
      localHostname: false,
      localhost: false,
    });
  });
});
