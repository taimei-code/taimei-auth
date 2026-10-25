import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./source-scan";

const CHECK_SCRIPT = `
import { validateRedirectUrl } from "./src/url-allowlist";
const results = {
  prodApp: validateRedirectUrl("https://app.taimei-code.com/", "taimei"),
  prodAuth: validateRedirectUrl("https://auth.taimei-code.com/account", "accounts"),
  localHostname: validateRedirectUrl("http://auth.taimei-code.localhost:3100/account", "accounts"),
  localhost: validateRedirectUrl("http://localhost:3100/account", "accounts"),
  httpProdAuth: validateRedirectUrl("http://auth.taimei-code.com/account", "accounts"),
  httpProdApp: validateRedirectUrl("http://app.taimei-code.com/", "taimei"),
};
console.log(JSON.stringify(results));
`;

describe("本番の redirect 先の定数 (bun test は bunfig の preload で本番以外の値に差し替えるので、preload の無い子 process で読む)", () => {
  test("https の本番の host だけを許し、手元の host と http は拒む", () => {
    const proc = Bun.spawnSync(["bun", "-e", CHECK_SCRIPT], { cwd: REPO_ROOT, env: process.env });

    expect(proc.exitCode).toBe(0);
    const results = JSON.parse(proc.stdout.toString().trim().split("\n").at(-1) ?? "{}");
    expect(results).toEqual({
      prodApp: true,
      prodAuth: true,
      localHostname: false,
      localhost: false,
      httpProdAuth: false,
      httpProdApp: false,
    });
  });
});
