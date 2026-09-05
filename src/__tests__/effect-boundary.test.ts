import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { grepFiles, REPO_ROOT } from "./grep-files";

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

  test("Sentry facade の直呼びは src/sentry.ts と reportInternalFailures (wire-error) だけ", () => {
    const allowed = new Set(["src/sentry.ts", "src/handlers/wire-error.ts"]);
    expect(
      srcFiles("Sentry\\.capture(Exception|Message)\\(").filter((f) => !allowed.has(f)),
    ).toEqual([]);
  });
  // wire-error の報告口は Effect の外で Sentry に触る裏口になるので、呼び出し側を adapter と better-auth の結線に固定する
  // (use-case / handler は SentryService を yield* する: src/CLAUDE.md「Effect様式」)。
  test("reportInternalFailures / captureThrown の呼び出しは adapter (run-route / run-rpc) と better-auth の結線 (auth.ts / app.ts) だけ", () => {
    const allowed = new Set([
      "src/handlers/wire-error.ts",
      "src/handlers/run-route.ts",
      "src/rpc/run-rpc.ts",
      "src/auth.ts",
      "src/app.ts",
    ]);
    expect(
      srcFiles("(reportInternalFailures|captureThrown)\\(").filter((f) => !allowed.has(f)),
    ).toEqual([]);
  });
});

// ---- test の DB 接触 (08-liftall-and-test-seeds §3.3): src の test と e2e は db/testing/* だけを runtime import する ----

// 静的 import (named / namespace) と動的 import (import 関数呼び出し) を拾い、`import type` / `export type` は除く。
// 1 行の形は grep で拾う。biome (lineWidth 100) が折り返した複数行の形は `} from "@/db/…"` の行を grep で拾い、
// その statement の先頭行を読んで型 import かどうかを判定する (行 grep だけだと複数行の runtime import が素通りする)。
const DB_SPECIFIER = String.raw`["']@/db/[^"']*["']`;
const DB_IMPORT_ONE_LINE = String.raw`(^import (\{|\*) .* from|import\()\s*${DB_SPECIFIER}`;
const DB_IMPORT_CLOSING = String.raw`^\} from\s*${DB_SPECIFIER}`;
const TS_FILES = ["*.ts", "*.tsx"];

type DbImport = { file: string; specifier: string };

const specifierOf = (text: string): string =>
  /["']@\/db\/[^"']*["']/.exec(text)?.[0].slice(1, -1) ?? "";

const multiLineImports = (file: string): DbImport[] => {
  const lines = readFileSync(isAbsolute(file) ? file : join(REPO_ROOT, file), "utf8").split("\n");
  const closing = new RegExp(DB_IMPORT_CLOSING);
  return lines.flatMap((line, i) => {
    if (!closing.test(line)) return [];
    const head =
      lines
        .slice(0, i)
        .reverse()
        .find((l) => /^(import|export)\b/.test(l)) ?? "";
    return /^(import|export) type\b/.test(head) ? [] : [{ file, specifier: specifierOf(line) }];
  });
};

const dbRuntimeImports = (target: string, opts: { onlyTests?: boolean } = {}): DbImport[] => {
  const oneLine = grepFiles(DB_IMPORT_ONE_LINE, target, {
    ...opts,
    include: TS_FILES,
    lines: true,
  }).map((hit) => {
    const sep = hit.indexOf(":");
    return { file: hit.slice(0, sep), specifier: specifierOf(hit.slice(sep + 1)) };
  });
  const multi = grepFiles(DB_IMPORT_CLOSING, target, { ...opts, include: TS_FILES }).flatMap(
    multiLineImports,
  );
  return [...oneLine, ...multi];
};

const dbImportFiles = (target: string, opts?: { onlyTests?: boolean }): string[] =>
  [...new Set(dbRuntimeImports(target, opts).map((i) => i.file))].sort();

const dbImportsOutsideTesting = (target: string): DbImport[] =>
  dbRuntimeImports(target).filter((i) => !i.specifier.startsWith("@/db/testing/"));

describe("test の DB 接触は db/testing/* に閉じる", () => {
  test("src の test の @/db runtime import は TestDb の face (src/__tests__/test-db.ts) のみ", () => {
    expect(dbImportFiles("src", { onlyTests: true })).toEqual(["src/__tests__/test-db.ts"]);
  });

  test("e2e の @/db runtime import は e2e/fixtures.ts の @/db/testing/* のみ", () => {
    expect(dbImportsOutsideTesting("e2e")).toEqual([]);
    expect(dbImportFiles("e2e")).toEqual(["e2e/fixtures.ts"]);
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
      expect(dbImportFiles(dir)).toEqual([
        join(dir, "dynamic.ts"),
        join(dir, "multi.ts"),
        join(dir, "static.ts"),
        join(dir, "testing.ts"),
      ]);
      expect(
        dbImportsOutsideTesting(dir)
          .map((i) => i.file)
          .sort(),
      ).toEqual([join(dir, "dynamic.ts"), join(dir, "multi.ts"), join(dir, "static.ts")]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ---- revokeAllSessionsForUser の窓口 (08 設計 A): ports が repository の全 export を公開するため、呼び出しを grep で閉じる ----

describe("revokeAllSessionsForUser の窓口", () => {
  test("port 経由の呼び出しは src/account/revoke-sessions.ts に限る (Redis 側の失効を伴う唯一の窓口)", () => {
    // biome の importNames ban は src/** だけに効くため、ports を組める management / e2e も同じ gate で閉じる。
    const offenders = ["src", "management", "e2e"].flatMap((dir) =>
      grepFiles(String.raw`\.revokeAllSessionsForUser\(`, dir, { excludeTests: true }),
    );
    expect(offenders).toEqual(["src/account/revoke-sessions.ts"]);
  });
});
