import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { type GrepOptions, grepFiles, REPO_ROOT } from "./grep-files";

// ADR-0017 / design §4 の import 境界 (I2): Repository 境界 db/ と 共通画面 SPA web/ は effect を持ち込まない。
// biome の noRestrictedImports は override の「最後に一致した copy が勝つ」semantics のため db/** 専用 override を
// 足すと web 専用 ban の 2 copy invariant (dependency-classification.test.ts) が崩れる。grep で固定する。

// `from "effect"` / `import "effect"` / `require("effect")` / `import("effect")` と `effect/...` 配下を拾う。
const EFFECT_IMPORT = String.raw`(from|import|require\(|import\()\s*["']effect(/[^"']*)?["']`;

const effectImports = (dir: string): string[] =>
  grepFiles(EFFECT_IMPORT, dir, { include: ["*.ts", "*.tsx"] });

// Stage ゲートはいずれも src/ の production code (テスト除外) を対象にする。
const srcFiles = (pattern: string): string[] => grepFiles(pattern, "src", { excludeTests: true });

describe("effect の import 境界 (ADR-0017)", () => {
  test("db/ は effect を import しない (Repository 境界、R1)", () => {
    expect(effectImports("db")).toEqual([]);
  });

  test("web/src は effect を import しない (共通画面 SPA と @core 共有 module は effect-free)", () => {
    expect(effectImports("web/src")).toEqual([]);
  });
});

// ---- Stage 完了ゲート (ADR-0017 Stage 表)。旧様式が src/ に残っていないことを grep で固定する ----

describe("Stage 2 ゲート (Use-case): Repository は ports 経由", () => {
  test("db/repositories と db/transaction の runtime import は wiring / id-generator / transaction / auth.ts に限る", () => {
    const allowed = new Set(["src/id-generator.ts", "src/transaction.ts", "src/auth.ts"]);
    const offenders = srcFiles(
      String.raw`^import (\{|\*) .* from "@/db/(repositories|transaction)`,
    ).filter((f) => !f.endsWith("/wiring.ts") && !allowed.has(f));
    expect(offenders).toEqual([]);
  });

  test("runInTransaction の直呼びは src/transaction.ts だけ", () => {
    expect(srcFiles("runInTransaction\\(").filter((f) => f !== "src/transaction.ts")).toEqual([]);
  });
});

describe("Stage 3 ゲート (MFA): 橋渡しの WireFailure / MfaFailure が消えている", () => {
  test("WireFailure / MfaFailure / fromResult / fromMfaResult の出現が 0", () => {
    expect(srcFiles("WireFailure|MfaFailure|fromResult\\(|fromMfaResult\\(")).toEqual([]);
  });
});

describe("Stage 4 ゲート (seam / runtime primitive)", () => {
  test("Promise.all の直呼びが 0 (Effect.all に統一)", () => {
    expect(srcFiles("Promise\\.all\\(")).toEqual([]);
  });

  test("runBackground の呼び出しは src/background.ts (Background service の live) だけ", () => {
    expect(srcFiles("runBackground\\(").filter((f) => f !== "src/background.ts")).toEqual([]);
  });

  test("Sentry facade の直呼びは src/sentry.ts と settleCause (client-facing-error) だけ", () => {
    const allowed = new Set(["src/sentry.ts", "src/handlers/client-facing-error.ts"]);
    expect(
      srcFiles("Sentry\\.capture(Exception|Message)\\(").filter((f) => !allowed.has(f)),
    ).toEqual([]);
  });

  // client-facing-error の報告口は Effect の外で Sentry に触る裏口になるので、呼び出し側を adapter と better-auth の結線に固定する
  // (use-case / handler は SentryService を yield* する: src/CLAUDE.md「Effect様式」)。
  // best-effort 記帳 (CONTEXT.md): use-case は appendAuditLogBestEffort を通す。raw appendAuditLog を直接 yield* すると
  // DbError が E channel に残り、成立済みの操作 (行削除 / verified 化 / session 発行) が 500 で返る。
  test("AuditLog.appendAuditLog の直呼びと swallowAuditFailure の pipe は src/audit/report-failure.ts (+ invitation accept の record* 経由) だけ", () => {
    expect(
      srcFiles("\\.appendAuditLog\\(").filter((f) => f !== "src/audit/report-failure.ts"),
    ).toEqual([]);
    const allowed = new Set(["src/audit/report-failure.ts", "src/invitation/accept.ts"]);
    expect(srcFiles("swallowAuditFailure\\(").filter((f) => !allowed.has(f))).toEqual([]);
  });

  // CONTEXT.md「fail-open で通した事実は Sentry に残し、silent には通さない」の code 側。
  test("silent な fold (orElseSucceed / Effect.ignore / logError だけの catch) は production src に無く、captureCause の直呼びは fail-closed / void 経路だけ (値に倒す経路は captureCauseAs)", () => {
    expect(srcFiles("orElseSucceed\\(|Effect\\.ignore\\(")).toEqual([]);
    expect(srcFiles("Effect\\.logError\\(")).toEqual(["src/email/client.ts"]);
    expect(srcFiles("captureCause\\(").sort()).toEqual([
      "src/audit/report-failure.ts",
      "src/auth-plugins/mfa-challenge.ts",
      "src/auth-plugins/sign-in-observer.ts",
      "src/handlers/account-invitation.ts",
      "src/membership/guard/core.ts",
      "src/mfa/disable-attempt-budget.ts",
      "src/mfa/gateway.ts",
      "src/mfa/notification-adapter.ts",
      "src/rpc/auth-handler.ts",
      "src/sentry.ts",
    ]);
  });

  // OWNER が減りうる write の呼び手を固定する。per-member の write は OWNER≥1 の判定を持つ apply-change.ts だけ、
  // 全削除 (removeMembershipsOfCompany) は事後 count が無い company/delete と backfill だけ。
  test("OWNER を減らしうる membership write の呼び手は apply-change / company delete / backfill だけ", () => {
    expect(
      srcFiles("\\.(updateMembershipRole|deleteMembership|removeMembershipsOfCompany)\\(").sort(),
    ).toEqual([
      "src/account/backfill-orphan-cleanup.ts",
      "src/company/delete.ts",
      "src/membership/apply-change.ts",
    ]);
  });

  test("settleCause / captureThrown の呼び出しは adapter (run-route / run-rpc) と better-auth の結線 (auth.ts / app.ts) だけ", () => {
    const allowed = new Set([
      "src/handlers/client-facing-error.ts",
      "src/handlers/run-route.ts",
      "src/rpc/run-rpc.ts",
      "src/auth.ts",
      "src/app.ts",
    ]);
    expect(srcFiles("(settleCause|captureThrown)\\(").filter((f) => !allowed.has(f))).toEqual([]);
  });
});

// ---- test の DB 接触 (08-liftall-and-test-seeds §3.3): src の test と e2e は db/testing/* だけを runtime import する ----

// 静的 import (named / namespace / default / side-effect / re-export) と動的 import (import 関数呼び出し) を拾い、
// `import type` / `export type` は除く。1 行の形は grep で拾う (default import の識別子は `type` にも当たるので、hit 行を
// 読んで型 import を落とす)。biome (lineWidth 100) が折り返した複数行の形は `} from "…"` の行を grep で拾い、その
// statement の先頭行を読んで型 import かどうかを判定する (行 grep だけだと複数行の runtime import が素通りする)。
type ImportGate = {
  readonly specifier: RegExp;
  readonly oneLine: string;
  readonly closing: string;
};
// `import { x } from` / `import * as x from` / `import x from` / `import x, { y } from` / `export { x } from` /
// `export * from` と side-effect の `import "…"`。
const STATIC_FORMS = String.raw`^(import|export) (\{|\*|[A-Za-z_$][A-Za-z0-9_$]*).* from|^import`;
const TYPE_ONLY = /^(import|export) type\b/;
const gateFor = (specifier: string): ImportGate => ({
  specifier: new RegExp(specifier),
  oneLine: String.raw`(${STATIC_FORMS}|import\()\s*${specifier}`,
  closing: String.raw`^\} from\s*${specifier}`,
});
const DB_IMPORTS = gateFor(`["']@/db/[^"']*["']`);
const TS_FILES = ["*.ts", "*.tsx"];
type ScanOptions = Pick<GrepOptions, "onlyTests" | "excludeTests">;

type ImportHit = { file: string; specifier: string };

const specifierOf = (gate: ImportGate, text: string): string =>
  gate.specifier.exec(text)?.[0].slice(1, -1) ?? "";

const multiLineImports = (gate: ImportGate, file: string): ImportHit[] => {
  const lines = readFileSync(isAbsolute(file) ? file : join(REPO_ROOT, file), "utf8").split("\n");
  const closing = new RegExp(gate.closing);
  return lines.flatMap((line, i) => {
    if (!closing.test(line)) return [];
    const head =
      lines
        .slice(0, i)
        .reverse()
        .find((l) => /^(import|export)\b/.test(l)) ?? "";
    return TYPE_ONLY.test(head) ? [] : [{ file, specifier: specifierOf(gate, line) }];
  });
};

const valueImports = (gate: ImportGate, target: string, opts: ScanOptions = {}): ImportHit[] => {
  const oneLine = grepFiles(gate.oneLine, target, {
    ...opts,
    include: TS_FILES,
    lines: true,
  }).flatMap((hit) => {
    const sep = hit.indexOf(":");
    const line = hit.slice(sep + 1);
    return TYPE_ONLY.test(line)
      ? []
      : [{ file: hit.slice(0, sep), specifier: specifierOf(gate, line) }];
  });
  const multi = grepFiles(gate.closing, target, { ...opts, include: TS_FILES }).flatMap((file) =>
    multiLineImports(gate, file),
  );
  return [...oneLine, ...multi];
};

const valueImportFiles = (gate: ImportGate, target: string, opts?: ScanOptions): string[] =>
  [...new Set(valueImports(gate, target, opts).map((i) => i.file))].sort();

const dbImportsOutsideTesting = (target: string): ImportHit[] =>
  valueImports(DB_IMPORTS, target).filter((i) => !i.specifier.startsWith("@/db/testing/"));

describe("test の DB 接触は db/testing/* に閉じる", () => {
  test("src の test の @/db runtime import は TestDb の face (src/__tests__/test-db.ts) のみ", () => {
    expect(valueImportFiles(DB_IMPORTS, "src", { onlyTests: true })).toEqual([
      "src/__tests__/test-db.ts",
    ]);
  });

  test("e2e の @/db runtime import は e2e/fixtures.ts の @/db/testing/* のみ", () => {
    expect(dbImportsOutsideTesting("e2e")).toEqual([]);
    expect(valueImportFiles(DB_IMPORTS, "e2e")).toEqual(["e2e/fixtures.ts"]);
  });

  test("positive control: 静的 (1 行 / 複数行) と動的 import は検出され、型 import は検出されない", () => {
    const dir = mkdtempSync(join(tmpdir(), "db-import-gate-"));
    try {
      // 本 file 自身が gate に当たらないよう、動的 import の形は文字列連結で組む。
      const dynamicImport = ["imp", "ort("].join("");
      writeFileSync(join(dir, "static.ts"), 'import { db } from "@/db/client";\n');
      writeFileSync(join(dir, "multi.ts"), 'import {\n  db,\n  schema,\n} from "@/db/client";\n');
      writeFileSync(
        join(dir, "dynamic.ts"),
        `const { db } = await ${dynamicImport}"@/db/client");\n`,
      );
      writeFileSync(join(dir, "type-only.ts"), 'import type { UserRow } from "@/db/schema";\n');
      writeFileSync(
        join(dir, "multi-type.ts"),
        'import type {\n  UserRow,\n  SessionRow,\n} from "@/db/schema";\n',
      );
      writeFileSync(join(dir, "testing.ts"), 'import { createSeed } from "@/db/testing/seed";\n');
      writeFileSync(join(dir, "side-effect.ts"), 'import "@/db/client";\n');
      writeFileSync(join(dir, "default.ts"), 'import db from "@/db/client";\n');
      writeFileSync(join(dir, "re-export.ts"), 'export { db } from "@/db/client";\n');
      writeFileSync(
        join(dir, "re-export-type.ts"),
        'export type { DbTx } from "@/db/transaction";\n',
      );
      expect(valueImportFiles(DB_IMPORTS, dir)).toEqual([
        join(dir, "default.ts"),
        join(dir, "dynamic.ts"),
        join(dir, "multi.ts"),
        join(dir, "re-export.ts"),
        join(dir, "side-effect.ts"),
        join(dir, "static.ts"),
        join(dir, "testing.ts"),
      ]);
      expect(
        dbImportsOutsideTesting(dir)
          .map((i) => i.file)
          .sort(),
      ).toEqual([
        join(dir, "default.ts"),
        join(dir, "dynamic.ts"),
        join(dir, "multi.ts"),
        join(dir, "re-export.ts"),
        join(dir, "side-effect.ts"),
        join(dir, "static.ts"),
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ---- revokeAllSessionsForUser の窓口 (08 設計 A): ports が repository の全 export を公開するため、呼び出しを grep で閉じる ----

describe("revokeAllSessionsForUser の窓口", () => {
  test("port 経由の呼び出しは src/account/revoke-sessions.ts に限る (TTL store 側の失効を伴う唯一の窓口)", () => {
    // biome の importNames ban は src/** だけに効くため、ports を組める management / e2e も同じ gate で閉じる。
    const offenders = ["src", "management", "e2e"].flatMap((dir) =>
      grepFiles(String.raw`\.revokeAllSessionsForUser\(`, dir, { excludeTests: true }),
    );
    expect(offenders).toEqual(["src/account/revoke-sessions.ts"]);
  });
});

// ---- AppLayer の構築失敗経路が無い (ADR-0017 Decision の runtime 項): ManagedRuntime.make は Layer を初回 run で構築するため、
// 構築で失敗しうる Layer (Layer.effect / scoped / unwrap 等) を足すと bootstrap でなく本番の初回 request で落ちる。
// Layer.succeed / mergeAll に限る間はその経路が無い。必要になったら、この gate と一緒に bootstrap の eager 構築を戻す ----

describe("AppLayer は構築で失敗しない Layer だけで組む", () => {
  test("src の Layer constructor は Layer.succeed / Layer.mergeAll だけ", () => {
    const hits = grepFiles(String.raw`Layer\.[a-z][A-Za-z]*\(`, "src", {
      excludeTests: true,
      lines: true,
    });
    expect(hits.filter((line) => !/Layer\.(succeed|mergeAll)\(/.test(line))).toEqual([]);
  });
});
