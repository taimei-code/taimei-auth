import { describe, expect, test } from "bun:test";
import { grepFiles } from "./grep-files";

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

  test("Sentry facade の直呼びは src/sentry.ts と adapter (run-route / run-rpc) だけ", () => {
    const allowed = new Set(["src/sentry.ts", "src/handlers/run-route.ts", "src/rpc/run-rpc.ts"]);
    expect(
      srcFiles("Sentry\\.capture(Exception|Message)\\(").filter((f) => !allowed.has(f)),
    ).toEqual([]);
  });
});
