import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor } from "../../membership/guard/core";
import type { countRemainingRecoveryCodes, readPendingTotpEnrollment } from "../gateway";

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

// management/ → src/ の import 面は file 単位でなく出現単位で全列挙する。file 単位の grep では
// 許可済み file に増えた 2 本目の import を見逃し、file 列挙のハードコードでは新規 file が
// 検査を素通りする。`from` / `import(` の行は整形で import が折り返されても 1 行に残る。
// 相対深度 (`../../src/` 等)・path alias (`@/` = repo root, `@core/` = src/)・side-effect import・
// dynamic import も同じ面に含める — 別表記の抜け道を残すと列挙が「全」でなくなる。
function srcImportOccurrences(root: string): string[] {
  const pattern = `(from|import)[ (]['"]((\\.\\./)+src/|@/|@core/)[^'"]*['"]`;
  const command = [
    `cd ${JSON.stringify(REPO_ROOT)} &&`,
    `grep -roE ${JSON.stringify(pattern)} --include=*.ts --exclude-dir=__tests__ ${root} || true`,
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
    // registration/status (行 SELECT を持つ read 経路) と registration/state (解釈 kernel) の
    // どちらもログイン境界に混入させない — 混入すると全ログインに pg 往復が増える
    // (この規律のWhy: src/mfa/policy.tsのコメント)。
    expect(
      filesWithCodeLiteral("from ['\"].*registration/(state|status)", "src/auth-plugins"),
    ).toEqual([]);
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
    ]);
    expect(
      filesWithCodeLiteral(`from ['"](\\./application|.*registration/application)['"]`),
    ).toEqual(["src/mfa/registration/wiring.ts"]);
  });

  test("QA-E-03 management/ → src/ の import 面は全列挙で固定する (MFA 経路は wiring の façade のみ)", () => {
    expect(srcImportOccurrences("management")).toEqual([
      'management/backfill-orphan-cleanup.ts:from "../src/account/backfill-orphan-cleanup"',
      'management/disable-user-mfa.ts:from "../src/mfa/registration/wiring"',
      'management/release-mfa-registration-guard.ts:from "../src/mfa/registration/wiring"',
      'management/sweep-abandoned-signups.ts:from "../src/account/sweep-abandoned-signups"',
    ]);
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

  test("QA-I-01 two_factor 行の読み書きの入口は列挙ファイルに限る (評決の組み立てを散らさない)", () => {
    expect(filesWithCodeLiteral("db/repositories/two-factor", "src")).toEqual([
      "src/mfa/gateway.ts",
      "src/mfa/registration/enroll.ts",
      "src/mfa/registration/force-disable.ts",
      "src/mfa/registration/restart.ts",
      "src/mfa/registration/status.ts",
    ]);
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

  test("QA-E-03 read-side operations (enroll/restart) は two-factor repository と入力の遷移内窓口以外を束縛しない", () => {
    // better-auth 窓口は runTransition が配る GuardedMfaGateway (入力) で届く — gateway の直束縛も
    // adapter (budget/audit/redis/sentry/結線) の混入も、fault seam の外に検証不能な経路を作るため塞ぐ。
    expect(
      filesWithCodeLiteral(
        "../gateway|../disable-attempt-budget|../../audit-error|../../redis|../../sentry|./wiring",
        "src/mfa/registration/enroll.ts src/mfa/registration/restart.ts",
      ),
    ).toEqual([]);
  });

  test("AC-011 gateway module の production importer は 5 ファイルに固定 (operations は façade 経由のみ)", () => {
    // 遷移内の better-auth 窓口は runTransition が配る — operations (enroll/restart/activate/disable)
    // がこの列挙に現れたら evidence-gating の迂回。dynamic import も含めるため from 限定にしない。
    expect(
      filesWithCodeLiteral(`(from|import)[ (]['"](\\.{1,2}/gateway|.*mfa/gateway)['"]`, "src"),
    ).toEqual([
      "src/mfa/challenge-store.ts",
      "src/mfa/complete-challenge.ts",
      "src/mfa/registration/force-disable.ts",
      "src/mfa/registration/status.ts",
      "src/mfa/registration/wiring.ts",
    ]);
  });

  // AC-012/AC-023 の正本表: gateway export ごとの許可出現ファイル (定義元 gateway.ts は暗黙)。
  // 新しい export は下の全数一致が表への行追加を要求し、行追加は出現面の明示を要求する。
  const GATEWAY_ENTRY_OCCURRENCES: Record<string, { pattern?: string; files: string[] }> = {
    activateTotp: {
      files: [
        "src/mfa/registration/activate.ts",
        "src/mfa/registration/ports.ts",
        "src/mfa/registration/wiring.ts",
      ],
    },
    clearTwoFactorEnabled: { files: ["src/mfa/registration/force-disable.ts"] },
    countRemainingRecoveryCodes: { files: ["src/mfa/registration/status.ts"] },
    disableTotp: {
      files: [
        "src/mfa/registration/disable.ts",
        "src/mfa/registration/ports.ts",
        "src/mfa/registration/wiring.ts",
      ],
    },
    enrollTotp: {
      files: [
        "src/mfa/registration/enroll.ts",
        "src/mfa/registration/ports.ts",
        "src/mfa/registration/restart.ts",
        "src/mfa/registration/wiring.ts",
      ],
    },
    getAuthContext: { files: ["src/mfa/challenge-store.ts"] },
    readPendingTotpEnrollment: {
      files: [
        "src/mfa/registration/enroll.ts",
        "src/mfa/registration/ports.ts",
        "src/mfa/registration/wiring.ts",
      ],
    },
    revokeOtherSessions: {
      files: [
        "src/mfa/registration/activate.ts",
        "src/mfa/registration/disable.ts",
        "src/mfa/registration/ports.ts",
        "src/mfa/registration/wiring.ts",
      ],
    },
    // WithoutGuard を除外しつつ行末の裸出現も拾う。
    verifyMfaCode: {
      pattern: "verifyMfaCode($|[^W])",
      files: ["src/mfa/registration/wiring.ts"],
    },
    verifyMfaCodeWithoutGuard: { files: ["src/mfa/complete-challenge.ts"] },
  };

  test("AC-012/AC-023 gateway 全 export の出現面を entry 単位で固定", () => {
    for (const [entry, { pattern, files }] of Object.entries(GATEWAY_ENTRY_OCCURRENCES)) {
      expect({ entry, files: filesWithCodeLiteral(pattern ?? entry) }).toEqual({
        entry,
        files: ["src/mfa/gateway.ts", ...files].sort(),
      });
    }
  });

  test("AC-023 gateway の export 全数が表の対象 (未 pin の新 export を赤にする)", async () => {
    // 実行せず parse だけで export 名を得る — better-auth の実構築 (~300ms) をこの静的 tripwire
    // ファイルへ持ち込まない。type export は runtime capability でないため表の対象外だが、名前の
    // denylist でなく宣言形 (`export type`) から導出する — runtime export をここへ逃がすには
    // export type へ変える必要があり、その時点で値として使えなくなる。
    const source = await Bun.file(resolve(REPO_ROOT, "src/mfa/gateway.ts")).text();
    const typeExports = [...source.matchAll(/^export type (?:\{ )?(\w+)/gm)].map((m) => m[1]);
    const scanned = new Bun.Transpiler({ loader: "ts" })
      .scan(source)
      .exports.filter((name) => !typeExports.includes(name))
      .sort();
    expect(scanned).toEqual(Object.keys(GATEWAY_ENTRY_OCCURRENCES).sort());
  });

  test("QA-M-06 production wiring keeps enabled and disabled notifications distinct", () => {
    // 末尾 comma まで一致させる — `notifyMfaDisabled` は `notifyMfaDisabledForManagement` の
    // prefix なので、comma なしでは self-service 側が management 用 (待機型・schedule なし) に
    // すり替わっても検出できない。
    expect(
      filesWithCodeLiteral("notifyEnabled: notifyMfaEnabled,", "src/mfa/registration"),
    ).toEqual(["src/mfa/registration/wiring.ts"]);
    expect(
      filesWithCodeLiteral("notifyDisabled: notifyMfaDisabled,", "src/mfa/registration"),
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
// 期待形は membership guard の Actor (外部所有) から test 内で導出する — gateway/contracts 側の
// MfaActor を anchor にすると自己比較の恒真になり、定義を狭めても検知できない。
type ExpectedMfaActor = Pick<Actor, "id" | "email" | "twoFactorEnabled">;
const acceptsStringUserId: string extends CountRemainingArg ? true : false = false;
const takesActor: CountRemainingArg extends ExpectedMfaActor
  ? ExpectedMfaActor extends CountRemainingArg
    ? true
    : false
  : false = true;
// 平文 secret + リカバリーコードを返す readPendingTotpEnrollment も同じ制約に pin する。
type ReadPendingArg = Parameters<typeof readPendingTotpEnrollment>[0];
const readPendingTakesActor: ReadPendingArg extends ExpectedMfaActor
  ? ExpectedMfaActor extends ReadPendingArg
    ? true
    : false
  : false = true;
const returnsRecoveryCodeArray: CountRemainingValue extends readonly string[] ? true : false =
  false;
const returnsCount: number extends CountRemainingValue ? true : false = true;

describe("countRemainingRecoveryCodes の型シグネチャ", () => {
  test("QA-M-14 引数は MfaActor で string の userId を渡せない (IDOR にしない)", () => {
    expect(acceptsStringUserId).toBe(false);
    expect(takesActor).toBe(true);
    expect(readPendingTakesActor).toBe(true);
  });

  test("QA-M-14 戻り値は残数のみでリカバリーコード配列を受け取れない", () => {
    expect(returnsRecoveryCodeArray).toBe(false);
    expect(returnsCount).toBe(true);
  });
});
