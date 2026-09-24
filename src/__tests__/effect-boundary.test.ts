import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { type GrepOptions, grepFiles, REPO_ROOT } from "./grep-files";

// biome で db/** 専用の override を足すと web 専用 ban の 2 コピー invariant が崩れるので grep で固定する。
const EFFECT_IMPORT = String.raw`(from|import|require\(|import\()\s*["']effect(/[^"']*)?["']`;

const effectImports = (dir: string): string[] =>
  grepFiles(EFFECT_IMPORT, dir, { include: ["*.ts", "*.tsx"] });

const srcFiles = (pattern: string): string[] => grepFiles(pattern, "src", { excludeTests: true });

describe("effect の import 境界 (ADR-0017)", () => {
  test("db/ は effect を import しない (Repository 境界、R1)", () => {
    expect(effectImports("db")).toEqual([]);
  });

  test("web/src は effect を import しない (共通画面 SPA と @core 共有 module は effect-free)", () => {
    expect(effectImports("web/src")).toEqual([]);
  });
});

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

  test("AuditLog.appendAuditLog の直呼びと swallowAuditFailure の pipe は src/audit/report-failure.ts (+ invitation accept の record* 経由) だけ", () => {
    expect(
      srcFiles("\\.appendAuditLog\\(").filter((f) => f !== "src/audit/report-failure.ts"),
    ).toEqual([]);
    const allowed = new Set(["src/audit/report-failure.ts", "src/invitation/accept.ts"]);
    expect(srcFiles("swallowAuditFailure\\(").filter((f) => !allowed.has(f))).toEqual([]);
  });

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

  test("membership 行の増減と role 変更、それに伴う current 事業所の付け替えは apply-change だけが呼ぶ", () => {
    expect(
      srcFiles(
        "\\.(insertMembership|updateMembershipRole|deleteMembership|removeMembershipsOfCompany|reassignLastUsedCompanyAfterLeaving)\\(",
      ),
    ).toEqual(["src/membership/apply-change.ts"]);
    expect(srcFiles("\\.updateUserLastUsedCompany\\(").sort()).toEqual([
      "src/account/switch-company.ts",
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

// biome (lineWidth 100) が折り返した複数行 import は `} from` 行から先頭行を辿って型 import を除外する (行 grep だけだと検出されない)。
type ImportGate = {
  readonly specifier: RegExp;
  readonly oneLine: string;
  readonly closing: string;
};
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
      // このファイル自身が gate に引っかからないよう、動的 import の形は文字列連結で組む。
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

describe("revokeAllSessionsForUser の窓口", () => {
  test("port 経由の呼び出しは src/account/revoke-sessions.ts に限る (TTL store 側の失効を伴う唯一の窓口)", () => {
    // biome の importNames ban は src/** にしか効かないので management と e2e も見る。
    const offenders = ["src", "management", "e2e"].flatMap((dir) =>
      grepFiles(String.raw`\.revokeAllSessionsForUser\(`, dir, { excludeTests: true }),
    );
    expect(offenders).toEqual(["src/account/revoke-sessions.ts"]);
  });
});

// ManagedRuntime.make は初回 run で Layer を構築するため、失敗し得る Layer (Layer.effect / scoped / unwrap) は本番の初回 request で落ちる。
describe("AppLayer は構築で失敗しない Layer だけで組む", () => {
  test("src の Layer constructor は Layer.succeed / Layer.mergeAll だけ", () => {
    const hits = grepFiles(String.raw`Layer\.[a-z][A-Za-z]*\(`, "src", {
      excludeTests: true,
      lines: true,
    });
    expect(hits.filter((line) => !/Layer\.(succeed|mergeAll)\(/.test(line))).toEqual([]);
  });
});
