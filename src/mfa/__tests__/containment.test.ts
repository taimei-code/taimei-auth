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
  test("QA-R-01 src/auth-plugins/ は登録状態 policy を import しない (直接 import 限定の近似)", () => {
    // 検索 dir の改名等で grep が空振りしても [] が返るため、実在の import で検出器が
    // 生きていることを先に確認する (positive control)。
    expect(filesWithCodeLiteral("from ", "src/auth-plugins").length).toBeGreaterThan(0);
    // registration/state のguard外経路は行SELECTを伴う。ログイン境界に混入すると
    // 全ログインにpg往復が増える (この規律のWhy: src/mfa/policy.tsのコメント)。
    expect(filesWithCodeLiteral("from ['\"].*registration/state", "src/auth-plugins")).toEqual([]);
  });
});

describe("MFA registration module boundary", () => {
  test("QA-E-02 public facade does not expose operation factories or dependency types", async () => {
    const facade = await import("../registration");
    expect(Object.keys(facade).sort()).toEqual(["activate", "disable", "enroll", "getStatus"]);
    expect(
      filesWithCodeLiteral(
        "createActivate|createDisable|ActivateDependencies|DisableDependencies",
        "src/mfa/registration/index.ts src/handlers",
      ),
    ).toEqual([]);
  });

  test("QA-E-03 phase 1 self-service facade does not expose restart", async () => {
    const facade = await import("../registration");
    expect("restart" in facade).toBe(false);
  });

  test("QA-E-03 IDなしactivate compatibilityのproduction importerはHTTP adapterだけ", () => {
    expect(filesWithCodeLiteral("registration/compatibility")).toEqual([
      "src/handlers/account-mfa.ts",
    ]);
  });

  test("QA-E-03 wiring/application の直 import で activateLegacy へ迂回できない", () => {
    // registrationApplication は activateLegacy を持つため、compatibility.ts の grep だけでは
    // ./wiring や ./application を直接 import する新しい呼び出し元が ID なし経路に乗れてしまう。
    expect(filesWithCodeLiteral(`from ['"](\\./wiring|.*registration/wiring)['"]`)).toEqual([
      "src/mfa/registration/compatibility.ts",
      "src/mfa/registration/index.ts",
      "src/mfa/registration/management.ts",
    ]);
    expect(
      filesWithCodeLiteral(`from ['"](\\./application|.*registration/application)['"]`),
    ).toEqual(["src/mfa/registration/wiring.ts"]);
  });

  test("QA-R-01 authとauth pluginはregistration moduleへback-edgeを持たない", () => {
    expect(filesWithCodeLiteral("mfa/registration", "src/auth.ts src/auth-plugins")).toEqual([]);
  });

  test("QA-I-01 registration state and port types do not leak back into legacy MFA modules", () => {
    const importers = filesWithCodeLiteral("registration/(state|ports)", "src/mfa").filter(
      (file) => !file.startsWith("src/mfa/registration/"),
    );
    expect(importers).toEqual([]);
  });

  test("QA-R-01 registration/ は kill-switch を参照しない (ADR-0013 §7: 混ぜると incident 中に disable の出口が閉じる)", () => {
    expect(filesWithCodeLiteral("MFA_CHALLENGE_ENABLED", "src/mfa/registration")).toEqual([]);
  });

  test("QA-I-01 db/ は src/ を import しない (分離時に逆流する依存を作らない)", () => {
    expect(filesWithCodeLiteral(`from ['"](\\.\\./)*\\.\\./src/`, "db")).toEqual([]);
  });

  test("QA-I-01 registration state writerのproduction importerはwiringだけ", () => {
    for (const operation of ["activate", "disable", "enroll", "restart"] as const) {
      expect(filesWithCodeLiteral(`from ['"].*/${operation}['"]`, "src")).toEqual([
        "src/mfa/registration/wiring.ts",
      ]);
    }
  });

  test("QA-E-03 operation factories do not bind infrastructure adapters directly", () => {
    expect(
      filesWithCodeLiteral(
        "../gateway|../disable-attempt-budget|../../audit-error|@/db/|./wiring",
        "src/mfa/registration/activate.ts src/mfa/registration/disable.ts",
      ),
    ).toEqual([]);
  });

  test("QA-M-06 production wiring keeps enabled and disabled notifications distinct", () => {
    expect(filesWithCodeLiteral("notifyEnabled: notifyMfaEnabled", "src/mfa/registration")).toEqual(
      ["src/mfa/registration/wiring.ts"],
    );
    expect(
      filesWithCodeLiteral("notifyDisabled: notifyMfaDisabled", "src/mfa/registration"),
    ).toEqual(["src/mfa/registration/wiring.ts"]);
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
