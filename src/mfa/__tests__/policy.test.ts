import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor } from "../../membership/guard/core";
import { requiresMfaChallenge } from "../policy";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const POLICY_FILE = join(REPO_ROOT, "src/mfa/policy.ts");

const actorWith = (twoFactorEnabled: boolean): Actor => ({
  id: "user-1",
  email: "alice@example.com",
  lastUsedCompanyId: null,
  twoFactorEnabled,
});

function countLinesMatching(pattern: string, file: string): number {
  // test 自身が policy.ts を import しており自 file を grep すると self-hit するため、
  // 対象 file だけをシェル外の grep に投げる (src/membership/__tests__/no-hono-import.test.ts と同じ手)。
  try {
    return Number(
      execSync(`grep -cE ${JSON.stringify(pattern)} ${JSON.stringify(file)}`, {
        encoding: "utf8",
      }).trim(),
    );
  } catch (_) {
    return 0;
  }
}

describe("requiresMfaChallenge (MFA チャレンジ要否の述語 kernel)", () => {
  test("QA-M-05 twoFactorEnabled の真偽がそのままチャレンジ要否になる", () => {
    expect(requiresMfaChallenge({ twoFactorEnabled: true })).toBe(true);
    expect(requiresMfaChallenge({ twoFactorEnabled: false })).toBe(false);
  });

  test("QA-M-05 判定源が 1 つに収束 — Actor をそのまま渡してログイン経路と同じ結果になる", () => {
    expect(requiresMfaChallenge(actorWith(true))).toBe(true);
    expect(requiresMfaChallenge(actorWith(false))).toBe(false);
  });

  test("QA-M-05 述語は import 0 件 — two_factor 行を読む第 2 の判定経路が生えない", () => {
    const importCount = countLinesMatching("^import ", POLICY_FILE);
    expect({ file: POLICY_FILE, importCount }).toEqual({ file: POLICY_FILE, importCount: 0 });

    const decidedSynchronously: boolean = requiresMfaChallenge(actorWith(true));
    expect(decidedSynchronously).toBe(true);
  });
});
