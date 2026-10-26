import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NON_PRODUCTION_DIRS } from "./config-invariant-helpers";
import { REPO_ROOT, repoFiles } from "./source-scan";

const MANUAL_REGRESSION = "docs/qa/manual-regression.md";
const TRIGGER_PATHS_LINE = /^- \*\*契機の path\*\*: (.+)$/m;
const NON_PRODUCTION_PATHS = [
  ...NON_PRODUCTION_DIRS,
  "packages/auth-client/testing",
  "packages/auth-client/src/testing.ts",
];

type Case = { readonly id: string; readonly globs: readonly string[] };

const casesIn = (document: string): Case[] =>
  document
    .split(/^## /m)
    .filter((section) => section.startsWith("QA-MR-"))
    .map((section) => ({
      id: section.slice(0, section.indexOf(":")),
      globs: [...(TRIGGER_PATHS_LINE.exec(section)?.[1] ?? "").matchAll(/`([^`]+)`/g)].map(
        ([, glob]) => glob ?? "",
      ),
    }));

const matchesAny = (globs: readonly string[], path: string) =>
  globs.some((glob) => new Bun.Glob(glob).match(path));

const filesNoCaseCovers = (cases: readonly Case[], files: readonly string[]) => {
  const globs = cases.flatMap(({ globs: own }) => own);
  return files.filter((file) => !matchesAny(globs, file));
};

const globsMatchingNothing = (cases: readonly Case[], files: readonly string[]) =>
  cases
    .flatMap(({ globs }) => globs)
    .filter((glob) => !files.some((file) => matchesAny([glob], file)));

const cases = casesIn(readFileSync(join(REPO_ROOT, MANUAL_REGRESSION), "utf8"));
const trackedFiles = repoFiles();
const nonProductionFiles = repoFiles(...NON_PRODUCTION_PATHS).filter(
  (file) => !file.includes("/__tests__/"),
);

describe("手動回帰の契機は path の一覧で書き、漏れと古くなった path を試験で見る", () => {
  test("どの QA-MR も「契機の path」の行を持つ", () => {
    expect(cases.length).toBeGreaterThanOrEqual(11);
    expect(cases.filter(({ globs }) => globs.length === 0).map(({ id }) => id)).toEqual([]);
  });

  test("本番以外の file は、どれも何かの QA-MR の契機の path に当たる", () => {
    expect(nonProductionFiles.length).toBeGreaterThan(20);
    expect(filesNoCaseCovers(cases, nonProductionFiles)).toEqual([]);
  });

  test("どの QA-MR の契機の path にも当たらない file は、漏れとして報告される", () => {
    expect(filesNoCaseCovers(cases, [...nonProductionFiles, "elsewhere/new-file.ts"])).toEqual([
      "elsewhere/new-file.ts",
    ]);
  });

  test("どの契機の path も、追跡中の file に 1 つ以上当たる (file の改名で古びない)", () => {
    expect(globsMatchingNothing(cases, trackedFiles)).toEqual([]);
  });

  test("どの file にも当たらない契機の path は、古くなった path として報告される", () => {
    const stale: Case = { id: "QA-MR-99", globs: ["renamed/away.ts"] };
    expect(globsMatchingNothing([...cases, stale], trackedFiles)).toEqual(["renamed/away.ts"]);
  });
});
