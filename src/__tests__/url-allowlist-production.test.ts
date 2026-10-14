import { describe, expect, test } from "bun:test";
import { join } from "node:path";

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

describe("allowlist の production 値 (allowedHostPattern は module ロード時に確定するので、子プロセスで APP_ENV=production にする)", () => {
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
