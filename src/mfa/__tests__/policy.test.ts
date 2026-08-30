import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requiresMfaChallenge } from "../policy";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const POLICY_FILE = join(REPO_ROOT, "src/mfa/policy.ts");

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
  test("QA-M-05 行なし (未登録) はチャレンジ不要", () => {
    expect(requiresMfaChallenge(undefined)).toBe(false);
  });

  test("QA-M-05 verifiedAt NULL (登録済み未有効) はチャレンジ不要", () => {
    expect(requiresMfaChallenge({ verifiedAt: null })).toBe(false);
  });

  test("QA-M-05 verifiedAt 非 NULL (有効) のみチャレンジ要", () => {
    expect(requiresMfaChallenge({ verifiedAt: new Date("2026-01-01T00:00:00Z") })).toBe(true);
  });

  test("QA-M-05 述語は import 0 件 — verified_at を直接比較する第 2 の判定経路が生えない", () => {
    const importCount = countLinesMatching("^import ", POLICY_FILE);
    expect({ file: POLICY_FILE, importCount }).toEqual({ file: POLICY_FILE, importCount: 0 });

    const decidedSynchronously: boolean = requiresMfaChallenge({ verifiedAt: new Date() });
    expect(decidedSynchronously).toBe(true);
  });
});
