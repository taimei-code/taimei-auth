import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { grepFiles, REPO_ROOT } from "../../__tests__/grep-files";

const HANDLERS_DIR = join(REPO_ROOT, "src/handlers");

describe("Transport 層の禁止事項 (ADR-0012 の regression ガード)", () => {
  test("QA-H-10 / QA-E-10 handlers/ (テスト除外) に runInTransaction 出現なし", () => {
    expect(grepFiles("runInTransaction", HANDLERS_DIR, { excludeTests: true })).toEqual([]);
  });

  test("SPA の API (/api/account、/api/mfa) は Hono に直接登録せず、契約から mountSpaApi で載せる", () => {
    const direct = String.raw`\.(get|post|put|patch|delete|all|on)\([^)]*["']/api/(account|mfa)`;
    const hits = grepFiles(direct, "src", { excludeTests: true, lines: true });
    expect(hits.filter((line) => !line.includes("HttpApiEndpoint."))).toEqual([]);
  });

  test("HttpApi の handler は HttpServerResponse を直接組まない (契約の応答の型を素通りしない)", () => {
    const raw = String.raw`HttpServerResponse\.(json|text|empty|raw|unsafeJson|html|stream)\(`;
    expect(grepFiles(raw, HANDLERS_DIR, { excludeTests: true, lines: true })).toEqual([]);
  });

  test("Stage 1 ゲート: handlers/ (テスト除外) に旧 guard API の呼び出しが無い", () => {
    const legacyApis = ["guardErrorResponse", "reasonToGuardError", "resolveParseBody"];
    const offenders = legacyApis.filter(
      (legacy) => grepFiles(legacy, HANDLERS_DIR, { excludeTests: true }).length > 0,
    );
    expect(offenders).toEqual([]);
  });
});
