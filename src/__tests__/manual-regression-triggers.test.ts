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

type Case = { readonly id: string; readonly globs: readonly string[]; readonly body: string };

const casesIn = (document: string): Case[] =>
  document
    .split(/^## /m)
    .filter((section) => section.startsWith("QA-MR-"))
    .map((section) => ({
      id: section.slice(0, section.indexOf(":")),
      globs: [...(TRIGGER_PATHS_LINE.exec(section)?.[1] ?? "").matchAll(/`([^`]+)`/g)].map(
        ([, glob]) => glob ?? "",
      ),
      body: section,
    }));

const stepsOf = (body: string) => body.slice(body.indexOf("- **手順**"));

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
    const stale: Case = { id: "QA-MR-99", globs: ["renamed/away.ts"], body: "" };
    expect(globsMatchingNothing([...cases, stale], trackedFiles)).toEqual(["renamed/away.ts"]);
  });
});

const EQUIPMENT_LINE = /^- \*\*機材\*\*: (.+)$/m;
const passkeyFiles = trackedFiles.filter(
  (file) =>
    /^((web\/)?src\/passkey\/|src\/handlers\/passkey-)/.test(file) && !file.includes("/__tests__/"),
);
const passkeyDeviceCase = cases.find(
  ({ globs, body }) =>
    EQUIPMENT_LINE.test(body) && passkeyFiles.some((file) => matchesAny(globs, file)),
);

describe("パスキーの実機の確認は、パスキーの file を契機にする手動回帰に書く", () => {
  test("パスキーの server と画面の file は、どれも何かの QA-MR の契機の path に当たる", () => {
    expect(passkeyFiles.length).toBeGreaterThan(10);
    expect(filesNoCaseCovers(cases, passkeyFiles)).toEqual([]);
  });

  test("パスキーの file を契機にする QA-MR は、機材に Mac の Touch ID (Chrome と Safari)、iPhone、Windows Hello、Android を挙げる", () => {
    expect(passkeyDeviceCase).toBeDefined();
    const equipment = EQUIPMENT_LINE.exec(passkeyDeviceCase?.body ?? "")?.[1] ?? "";
    for (const device of ["Touch ID", "Chrome", "Safari", "iPhone", "Windows Hello", "Android"]) {
      expect(equipment).toContain(device);
    }
  });

  test("パスキーの file を契機にする QA-MR は staging で、登録、ログイン、削除と、パスキーに対応していない browser を確かめる", () => {
    const body = passkeyDeviceCase?.body ?? "";
    expect(body).toContain("staging");
    const steps = stepsOf(body);
    for (const topic of ["登録", "ログイン", "削除", "パスキーに対応していない browser"]) {
      expect(steps).toContain(topic);
    }
  });
});

const DEV_ENVIRONMENT_ENTRY = "testing/dev-worker.ts";
const devEntrySteps = cases
  .filter(({ globs }) => globs.includes(DEV_ENVIRONMENT_ENTRY))
  .map(({ body }) => stepsOf(body));

describe("開発環境のフィーチャーフラグの確認は、開発環境の入口を契機にする手動回帰に書く", () => {
  test("開発環境の入口を契機の path に名指しする QA-MR が、Local Explorer でフィーチャーフラグを切り替える手順を書く", () => {
    const steps = cases
      .filter(({ globs }) => globs.includes(DEV_ENVIRONMENT_ENTRY))
      .map(({ body }) => stepsOf(body));
    expect(steps.some((step) => step.includes("Local Explorer"))).toBe(true);
  });

  test("開発環境の入口を契機の path に名指しする QA-MR が、開発者ホームの link から Local Explorer を開く手順を書く", () => {
    expect(
      devEntrySteps
        .flatMap((steps) => steps.split("\n"))
        .filter((line) => /^\s+\d+\. /.test(line))
        .some(
          (line) =>
            line.includes("開発者ホーム") &&
            line.includes("link") &&
            line.includes("Local Explorer"),
        ),
    ).toBe(true);
  });

  test("開発環境の入口を契機の path に名指しする QA-MR が、image を作り直した後も切り替えが残ることを確かめる手順を書く", () => {
    expect(
      devEntrySteps
        .flatMap((steps) => steps.split("\n"))
        .some((line) => line.includes("image") && line.includes("作り直")),
    ).toBe(true);
  });
});
