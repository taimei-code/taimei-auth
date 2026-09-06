import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// import 面は file 単位でなく出現単位で全列挙する。file 単位の grep では許可済み file に増えた
// 2 本目の import を見逃し、file 列挙のハードコードでは新規 file が検査を素通りする。
function importOccurrences(root: string, targetPattern: string): string[] {
  const pattern = `(from|import)[ (]['"]${targetPattern}[^'"]*['"]`;
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
  test("QA-R-01 auth-plugins が import してよい mfa モジュールは 4 つに限る", () => {
    // 検出器が生きていることの positive control。
    expect(filesWithCodeLiteral("from ", "src/auth-plugins").length).toBeGreaterThan(0);
    // hot path へ行 SELECT 以外の DB 依存を混入させない — challenge-required (最小射影の +1 SELECT)
    // と login-challenge (cookie 素材) 以外の mfa モジュールをログイン境界に増やさない (ADR-0016 §4.4)。
    expect(importOccurrences("src/auth-plugins", "[^'\"]*mfa/")).toEqual([
      `src/auth-plugins/mfa-challenge.ts:from "../mfa/kill-switch"`,
      `src/auth-plugins/mfa-challenge.ts:from "../mfa/redirect-guard"`,
      `src/auth-plugins/mfa-challenge.ts:from "../mfa/totp/challenge-required"`,
      `src/auth-plugins/mfa-challenge.ts:from "../mfa/totp/login-challenge"`,
      `src/auth-plugins/primary-auth-routes.ts:from "../mfa/totp/login-challenge"`,
    ]);
    // mfa_totp repository の直接 import は 0 件 (読み口は challenge-required に一本化。
    // sign-in-observer の audit-log repository は観測用で対象外)。
    expect(filesWithCodeLiteral("db/repositories/mfa-totp", "src/auth-plugins")).toEqual([]);
  });
});

describe("MFA totp module boundary", () => {
  test("AC-150a gateway の runtime export は revokeOtherSessions / issueSessionFor の 2 つ", async () => {
    const source = await Bun.file(resolve(REPO_ROOT, "src/mfa/gateway.ts")).text();
    const typeExports = [...source.matchAll(/^export type (?:\{ )?(\w+)/gm)].map((m) => m[1]);
    const scanned = new Bun.Transpiler({ loader: "ts" })
      .scan(source)
      .exports.filter((name) => !typeExports.includes(name))
      .sort();
    expect(scanned).toEqual(["issueSessionFor", "revokeOtherSessions"]);
  });

  test("AC-150a gateway の production importer は totp/wiring.ts のみ", () => {
    expect(
      filesWithCodeLiteral(`(from|import)[ (]['"](\\.{1,2}/gateway|.*mfa/gateway)['"]`, "src"),
    ).toEqual(["src/mfa/totp/wiring.ts"]);
  });

  test("AC-150f gateway の session cookie 直列化は hono serialize に委ね、手組みしない (session cookie 契約)", () => {
    // 根拠は CONTEXT.md「session cookie」、挙動の固定は src/__tests__/session-cookie-contract.test.ts。ここは
    // 手組みへの逆戻りの意図を最速で拾う静的 tripwire。root は src/mfa に固定する (file path を渡すと file が
    // 無い時に空集合で素通りする)。login-challenge.ts の hit が検出器の positive control を兼ねる。
    expect(filesWithCodeLiteral("hono/utils/cookie", "src/mfa")).toEqual([
      "src/mfa/gateway.ts",
      "src/mfa/totp/login-challenge.ts",
    ]);
    expect(filesWithCodeLiteral("Max-Age=|HttpOnly|SameSite=", "src/mfa")).toEqual([]);
  });

  test("AC-150b db/repositories/mfa-totp の production importer 列挙", () => {
    // repository の Effect face は ports (型) + wiring (結線) に閉じ、use-case と management CLI は
    // service を yield* する (ADR-0017 Stage 3)。id-generator は採番関数の正本。
    expect(filesWithCodeLiteral("db/repositories/mfa-totp", "src management")).toEqual([
      "src/id-generator.ts",
      "src/mfa/totp/enroll-mfa.ts",
      "src/mfa/totp/ports.ts",
      "src/mfa/totp/wiring.ts",
    ]);
  });

  test("AC-150d チャレンジ cookie 名リテラルは login-challenge.ts のみ", () => {
    expect(filesWithCodeLiteral("mfa_login_challenge")).toEqual([
      "src/mfa/totp/login-challenge.ts",
    ]);
  });

  test("AC-150e secret 材料を返す findMfaTotp の importer 列挙", () => {
    // findMfaTotp は secret 列を含む全射影 — 復号材料を扱ってよいのは use-case の 3 file に限る
    // (ports / wiring は LiftedModule / liftAll で repository module から導出するため、関数名を持たない)。
    expect(filesWithCodeLiteral("findMfaTotp", "src db management")).toEqual([
      "db/repositories/mfa-totp.ts",
      "src/mfa/totp/activate-mfa.ts",
      "src/mfa/totp/enroll-mfa.ts",
      "src/mfa/totp/verify-code.ts",
    ]);
  });

  test("QA-E-02 façade の runtime export 面 (handler が使ってよい面) を固定", async () => {
    const facade = await import("../totp");
    expect(Object.keys(facade).sort()).toEqual([
      "activate",
      "completeLoginChallenge",
      "disable",
      "enroll",
      "readLoginChallengeState",
      "readOwnedMfaStatus",
    ]);
  });

  test("QA-M-06 有効化通知と無効化通知の結線が入れ替わらない", () => {
    expect(filesWithCodeLiteral("notifyEnabled: notifyMfaEnabled,", "src/mfa/totp")).toEqual([
      "src/mfa/totp/wiring.ts",
    ]);
    expect(filesWithCodeLiteral("notifyDisabled: notifyMfaDisabled,", "src/mfa/totp")).toEqual([
      "src/mfa/totp/wiring.ts",
    ]);
  });

  test("QA-E-03 management/ の import 面は全列挙で固定する", () => {
    expect(importOccurrences("management", `((\\.\\./)+(src|db)/|@/|@core/)`)).toEqual([
      `management/backfill-orphan-cleanup.ts:from "../src/account/backfill-orphan-cleanup"`,
      `management/backfill-orphan-cleanup.ts:from "../src/runtime"`,
      `management/disable-user-mfa.ts:from "../src/account/ports"`,
      `management/disable-user-mfa.ts:from "../src/audit/ports"`,
      `management/disable-user-mfa.ts:from "../src/audit/report-failure"`,
      `management/disable-user-mfa.ts:from "../src/mfa/notification-adapter"`,
      `management/disable-user-mfa.ts:from "../src/mfa/totp/ports"`,
      `management/disable-user-mfa.ts:from "../src/runtime"`,
      `management/disable-user-mfa.ts:from "../src/transaction"`,
      `management/sweep-abandoned-signups.ts:from "../src/account/sweep-abandoned-signups"`,
      `management/sweep-abandoned-signups.ts:from "../src/runtime"`,
    ]);
  });

  test("QA-I-01 db/ は src/ を import しない (分離時に逆流する依存を作らない)", () => {
    expect(filesWithCodeLiteral(`from ['"](\\.\\./)*\\.\\./src/`, "db")).toEqual([]);
  });
});
