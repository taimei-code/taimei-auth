import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor } from "../../membership/guard/core";
import type { countRemainingRecoveryCodes } from "../gateway";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SEARCH_ROOTS = "src web/src";

// __tests__ 除外は self-hit 回避 (この file 自身がパターン文字列を持つ)。コメント内の出現は
// 封じ込め違反でないため `//` 以降を落としてから判定する (`[^:]` は URL の `://` を残すため)。
function filesWithCodeLiteral(pattern: string, roots: string = SEARCH_ROOTS): string[] {
  const command = [
    `cd ${JSON.stringify(REPO_ROOT)} &&`,
    `for f in $(grep -rlE ${JSON.stringify(pattern)}`,
    `--include=*.ts --include=*.tsx --exclude-dir=__tests__ ${roots}); do`,
    `if sed -E 's#(^|[^:])//.*#\\1#' "$f" | grep -qE ${JSON.stringify(pattern)};`,
    `then echo "$f"; fi; done`,
  ].join(" ");
  return execSync(command, { encoding: "utf8", shell: "/bin/bash" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

describe("ログイン hot path の非影響 (静的 tripwire)", () => {
  test("QA-R-01 src/auth-plugins/ は enrollment-state を import しない (直接 import 限定の近似)", () => {
    // 検索 dir の改名等で grep が空振りしても [] が返るため、実在の import で検出器が
    // 生きていることを先に確認する (positive control)。
    expect(filesWithCodeLiteral("from ", "src/auth-plugins").length).toBeGreaterThan(0);
    // enrollment-state は全 entry が行 SELECT を持つ eager 判定。ログイン境界に混入すると
    // 全ログインに pg 往復が増える (この規律の Why: src/mfa/policy.ts のコメント)。
    expect(filesWithCodeLiteral("from ['\"].*enrollment-state", "src/auth-plugins")).toEqual([]);
  });
});

describe("プラグイン内部形式の封じ込め (静的 tripwire)", () => {
  test("QA-M-11 two_factor リテラルを持つコードは challenge-store.ts だけ", () => {
    expect(filesWithCodeLiteral("two_factor")).toEqual(["src/mfa/challenge-store.ts"]);
  });

  test("QA-M-11 2fa- リテラルを持つコードは challenge-store.ts だけ", () => {
    expect(filesWithCodeLiteral("2fa-")).toEqual(["src/mfa/challenge-store.ts"]);
  });

  test("QA-M-14 viewBackupCodes / backupCodes を触るコードは gateway.ts だけ", () => {
    expect(filesWithCodeLiteral("viewBackupCodes")).toEqual(["src/mfa/gateway.ts"]);
    expect(filesWithCodeLiteral("backupCodes")).toEqual(["src/mfa/gateway.ts"]);
  });
});

type CountRemaining = typeof countRemainingRecoveryCodes;
type CountRemainingArg = Parameters<CountRemaining>[0];
type CountRemainingValue = Awaited<ReturnType<CountRemaining>>;

// 型注釈と代入値が食い違えば typecheck が落ちる。expect は同じ判定を test 実行側にも出す。
const acceptsStringUserId: string extends CountRemainingArg ? true : false = false;
const takesActor: CountRemainingArg extends Actor
  ? Actor extends CountRemainingArg
    ? true
    : false
  : false = true;
const returnsRecoveryCodeArray: CountRemainingValue extends readonly string[] ? true : false =
  false;
const returnsCount: number extends CountRemainingValue ? true : false = true;

describe("countRemainingRecoveryCodes の型シグネチャ", () => {
  test("QA-M-14 引数は Actor で string の userId を渡せない (IDOR にしない)", () => {
    expect(acceptsStringUserId).toBe(false);
    expect(takesActor).toBe(true);
  });

  test("QA-M-14 戻り値は残数のみでリカバリーコード配列を受け取れない", () => {
    expect(returnsRecoveryCodeArray).toBe(false);
    expect(returnsCount).toBe(true);
  });
});
