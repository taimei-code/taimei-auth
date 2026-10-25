import { describe, expect, test } from "bun:test";
import { grepFiles } from "./source-scan";

const READS_APP_ENV = "\\bAPP_ENV\\b";
const SENTRY_ENVIRONMENT_ENTRY = "src/worker.ts";
const READS_BUILD_MODE = "import\\.meta\\.env\\.(MODE|PROD|DEV)\\b";

describe("本番の code は自分が本番かどうかを知らない", () => {
  test("src/ で APP_ENV を読むのは、Sentry の環境名を決める入口だけ", () => {
    expect(grepFiles(READS_APP_ENV, "src", { tests: "exclude" })).toEqual([
      SENTRY_ENVIRONMENT_ENTRY,
    ]);
  });

  test("web/src は vite の build の mode を読まない", () => {
    expect(grepFiles(READS_BUILD_MODE, "web/src", { tests: "exclude" })).toEqual([]);
  });

  test("build の mode で分岐する行は、検査の正規表現に一致する", () => {
    expect(
      new RegExp(READS_BUILD_MODE).test('{import.meta.env.MODE === "production" && <Banner />}'),
    ).toBe(true);
  });

  test("APP_ENV で分岐する行は、検査の正規表現に一致する", () => {
    expect(
      new RegExp(READS_APP_ENV).test('const secure = process.env.APP_ENV === "production";'),
    ).toBe(true);
  });
});
