import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_MFA_TOTP_ENCRYPTION_KEYS } from "../mfa/__tests__/helpers";
import { REPO_ROOT } from "./grep-files";

describe("e2e の起動設定", () => {
  test("e2e サーバーの既定の暗号鍵は bun test の既定の鍵と同じ", () => {
    const script = readFileSync(join(REPO_ROOT, "e2e", "start-server.sh"), "utf8");
    const fallback = /MFA_TOTP_ENCRYPTION_KEYS:-([^}]+)\}/.exec(script)?.[1];
    expect(fallback).toBe(TEST_MFA_TOTP_ENCRYPTION_KEYS);
  });

  test("e2e のファイル名は bun test が拾う形 (.test. / .spec. / _test. / _spec.) にしない", () => {
    const pickedByBunTest = readdirSync(join(REPO_ROOT, "e2e")).filter((name) =>
      /[._](test|spec)\.[cm]?[jt]sx?$/.test(name),
    );
    expect(pickedByBunTest).toEqual([]);
  });
});
