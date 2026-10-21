import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  grepFiles,
  grepLines,
  REPO_ROOT,
  repoFiles,
  valueImportsOf,
} from "../../__tests__/source-scan";

const HANDLERS_DIR = join(REPO_ROOT, "src/handlers");

const SPA_HANDLERS = repoFiles("src/handlers/*-http-api.ts").filter(
  (file) => file !== "src/handlers/spa-http-api.ts",
);

describe("Transport 層の禁止事項 (ADR-0012 の regression ガード)", () => {
  test("handlers/ (テスト除外) に runInTransaction 出現なし", () => {
    expect(grepFiles("runInTransaction", HANDLERS_DIR, { tests: "exclude" })).toEqual([]);
  });

  test("SPA の API (/api/account、/api/mfa) は Hono に直接登録せず、契約から mountSpaApi で載せる", () => {
    const direct = String.raw`\.(get|post|put|patch|delete|all|on)\([^)]*["']/api/(account|mfa)`;
    const hits = grepLines(direct, "src", { tests: "exclude" });
    expect(hits.filter((line) => !line.includes("HttpApiEndpoint."))).toEqual([]);
  });

  test("HttpApi の handler は HttpServerResponse を直接組まない (契約の応答の型を素通りしない)", () => {
    const raw = String.raw`HttpServerResponse\.(json|text|empty|raw|unsafeJson|html|stream)\(`;
    expect(grepLines(raw, HANDLERS_DIR, { tests: "exclude" })).toEqual([]);
  });

  test("SPA の handler は repository の port を値として import せず、guard の値を use-case か読み出しの関数に渡す", () => {
    expect(
      SPA_HANDLERS.filter((file) =>
        valueImportsOf(file).some((imported) => imported.endsWith("/ports")),
      ),
    ).toEqual([]);
  });
});
