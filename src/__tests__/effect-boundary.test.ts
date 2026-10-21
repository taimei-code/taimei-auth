import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filesImporting, grepFiles, grepLines } from "./source-scan";

const EFFECT_IMPORT = String.raw`(from|import|require\(|import\()\s*["']effect(/[^"']*)?["']`;

const effectImports = (dir: string): string[] => grepFiles(EFFECT_IMPORT, dir);

const srcFiles = (pattern: string): string[] => grepFiles(pattern, "src", { tests: "exclude" });

describe("effect の import 境界 (ADR-0017)", () => {
  test("db/ は effect を import しない (Repository 境界。biome に db 専用の override を足すと web の ban の複製が崩れるので grep で固定する)", () => {
    expect(effectImports("db")).toEqual([]);
  });

  test("web/src の effect の subpath は effect/reactivity と effect/http だけ", () => {
    const subpaths = grepLines(String.raw`(from|import)\s*["']effect/`, "web/src", {});
    expect(subpaths.filter((line) => !/["']effect\/(reactivity|http)["']/.test(line))).toEqual([]);
  });
});

describe("Use-case は Repository を ports 経由で使う", () => {
  test("db/repositories と db/transaction の runtime import は wiring / id-generator / transaction / auth.ts に限る", () => {
    const allowed = new Set(["src/id-generator.ts", "src/transaction.ts", "src/auth.ts"]);
    const offenders = filesImporting(/^@\/db\/(repositories|transaction)/, "src", {
      tests: "exclude",
    }).filter((f) => !f.endsWith("/wiring.ts") && !allowed.has(f));
    expect(offenders).toEqual([]);
  });

  test("runInTransaction の直呼びは src/transaction.ts だけ", () => {
    expect(srcFiles("runInTransaction\\(").filter((f) => f !== "src/transaction.ts")).toEqual([]);
  });
});

describe("副作用と runtime の入口は、決まった module だけが呼ぶ", () => {
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

  test("audit log の書き込み (appendAuditLog / appendAuditLogs) を呼ぶのは src/audit/append.ts の 2 つの入口だけ", () => {
    expect(srcFiles("\\.appendAuditLogs?\\(")).toEqual(["src/audit/append.ts"]);
  });

  test("silent な fold (orElseSucceed / Effect.ignore / logError だけの catch) は production src に無く、captureCause の直呼びは fail-closed / void 経路だけ (値に倒す経路は captureCauseAs)", () => {
    expect(srcFiles("orElseSucceed\\(|Effect\\.ignore\\(")).toEqual([]);
    expect(srcFiles("Effect\\.logError\\(")).toEqual(["src/email/client.ts"]);
    expect(srcFiles("captureCause\\(").sort()).toEqual([
      "src/account/delete-sessions.ts",
      "src/audit/append.ts",
      "src/auth-plugins/mfa-challenge.ts",
      "src/auth-plugins/sign-in-observer.ts",
      "src/invitation/create.ts",
      "src/membership/guard/core.ts",
      "src/mfa/disable-attempt-budget.ts",
      "src/mfa/notification-adapter.ts",
      "src/mfa/totp/login-challenge.ts",
      "src/rpc/auth-handler.ts",
      "src/sentry.ts",
    ]);
  });

  test("試行枠の計数 (incrementRateWindow) を呼ぶのは attempt-budget だけ (fail-open / fail-closed の宣言を迂回させない)", () => {
    expect(srcFiles("\\bincrementRateWindow\\b").sort()).toEqual([
      "src/attempt-budget.ts",
      "src/ttl-store-service.ts",
      "src/ttl-store.ts",
    ]);
  });

  test("membership 行の増減と role 変更は apply-change だけが、現在の事業所の書き込みは current-company だけが呼ぶ", () => {
    expect(
      srcFiles(
        "\\.(insertMembership|updateMembershipRole|deleteMembership|removeMembershipsOfCompany)\\(",
      ).sort(),
    ).toEqual(["src/membership/apply-change.ts"]);
    expect(
      srcFiles("\\.(updateUserLastUsedCompany|reassignLastUsedCompanyAfterLeaving)\\(").sort(),
    ).toEqual(["src/membership/current-company.ts"]);
  });

  test("settleCause / captureThrown の呼び出しは adapter (run-route / run-rpc) と better-auth の結線 (auth.ts / app.ts) だけ", () => {
    const allowed = new Set([
      "src/handlers/client-facing-error.ts",
      "src/handlers/run-route.ts",
      "src/handlers/spa-http-api.ts",
      "src/rpc/run-rpc.ts",
      "src/auth.ts",
      "src/app.ts",
    ]);
    expect(srcFiles("(settleCause|captureThrown)\\(").filter((f) => !allowed.has(f))).toEqual([]);
  });

  test("route の AuthApi を差し替える authApiLayer は、テストだけが設定する", () => {
    expect(srcFiles("authApiLayer")).toEqual(["src/handlers/run-route.ts"]);
    expect(srcFiles(String.raw`\.set\(\s*["']authApiLayer["']`)).toEqual([]);
  });

  test("better-auth の auth instance を値で import するのは app.ts と auth-wiring.ts だけ (Effect からの入口は AuthApi)", () => {
    expect(
      srcFiles(
        String.raw`^import \{([^}]*[ ,])?auth([ ,][^}]*)?\} from ["'](\.\.?/)+auth["']`,
      ).sort(),
    ).toEqual(["src/app.ts", "src/auth-wiring.ts"]);
  });

  test("auth module を値で import するのは app.ts と auth-wiring.ts、initAuth を呼ぶ boot.ts だけ (複数行・名前空間・動的 import も数える)", () => {
    expect(filesImporting(/^(@\/src\/|(\.\.?\/)+)auth$/, "src", { tests: "exclude" })).toEqual([
      "src/app.ts",
      "src/auth-wiring.ts",
      "src/boot.ts",
    ]);
  });

  test("initRuntime と initAuth を呼ぶのは boot.ts だけ (runtime と better-auth に同じ TTL store を渡す)", () => {
    const pattern = String.raw`\b(initRuntime|initAuth)\(`;
    expect(
      [...srcFiles(pattern), ...grepFiles(pattern, "management", { tests: "exclude" })].sort(),
    ).toEqual(["src/auth.ts", "src/boot.ts", "src/runtime.ts"]);
  });

  test("資格情報を確かめずに session を発行する AuthApi.issueSession を呼ぶのは、第二要素の検証を終えた complete-login-challenge.ts だけ", () => {
    expect(srcFiles("(^|[^A-Za-z0-9_$])issueSession([^A-Za-z0-9_$]|$)").sort()).toEqual([
      "src/auth-service.ts",
      "src/auth-wiring.ts",
      "src/mfa/totp/complete-login-challenge.ts",
    ]);
  });

  test("有効な session の判定 (AuthApi.getSession) を呼ぶのは session-check.ts だけ (入口・SPA の guard・RPC が同じ判定を使う)", () => {
    expect(srcFiles(String.raw`\.getSession\(`).sort()).toEqual([
      "src/auth-wiring.ts",
      "src/session-check.ts",
    ]);
  });

  test("better-auth の APIError の形 (body.code) を読むのは auth-wiring.ts だけ", () => {
    expect(srcFiles(String.raw`UNAUTHORIZED|cause\.body|body\.code`)).toEqual([
      "src/auth-wiring.ts",
    ]);
  });
});

const DB_IMPORT = /^@\/db\//;
const DB_IMPORT_OUTSIDE_TESTING = /^@\/db\/(?!testing\/)/;

describe("test の DB 接触は db/testing/* に閉じる", () => {
  test("src の test の @/db runtime import は TestDb の face (src/__tests__/test-db.ts) のみ", () => {
    expect(filesImporting(DB_IMPORT, "src", { tests: "only" })).toEqual([
      "src/__tests__/test-db.ts",
    ]);
  });

  test("e2e の @/db runtime import は e2e/fixtures.ts の @/db/testing/* のみ", () => {
    expect(filesImporting(DB_IMPORT_OUTSIDE_TESTING, "e2e")).toEqual([]);
    expect(filesImporting(DB_IMPORT, "e2e")).toEqual(["e2e/fixtures.ts"]);
  });

  test("positive control: 静的 (1 行 / 複数行) と動的 import は検出され、型 import は検出されない", () => {
    const dir = mkdtempSync(join(tmpdir(), "db-import-gate-"));
    try {
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
      expect(filesImporting(DB_IMPORT, dir)).toEqual([
        join(dir, "default.ts"),
        join(dir, "dynamic.ts"),
        join(dir, "multi.ts"),
        join(dir, "re-export.ts"),
        join(dir, "side-effect.ts"),
        join(dir, "static.ts"),
        join(dir, "testing.ts"),
      ]);
      expect(filesImporting(DB_IMPORT_OUTSIDE_TESTING, dir)).toEqual([
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

describe("appLayer は構築で失敗しない Layer だけで組む", () => {
  test("src の Layer constructor は Layer.succeed / Layer.mergeAll と、context を読むだけの SPA の API の 2 行 (ADR-0017) と試行枠の middleware だけ (Layer.provide は合成だけなので数えない。ManagedRuntime は初回の run で Layer を構築するので、失敗し得る Layer は本番の初回 request で落ちる)", () => {
    const hits = grepLines(String.raw`Layer\.[a-z][A-Za-z]*\(`, "src", { tests: "exclude" });
    const readsContextOnly =
      /^src\/handlers\/spa-http-api\.ts:(const AuthenticatedLive = Layer\.effect\(|\s*Layer\.effectContext\(getRuntime\(\)\.contextEffect\))|^src\/handlers\/attempt-budget-http-api\.ts:\s*Layer\.effect\(/;
    expect(
      hits.filter(
        (line) => !/Layer\.(succeed|mergeAll|provide)\(/.test(line) && !readsContextOnly.test(line),
      ),
    ).toEqual([]);
  });
});
