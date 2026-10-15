import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, SOURCE_ROOTS, sourceFiles } from "./source-scan";

const TEST_FILE = /\.(test\.tsx?|e2e\.ts)$/;
const TEST_NAME =
  /(?:^|[^\w.$])(?:describe|it|test)(?:\.\w+)*\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const EACH_ROW_LABEL = /^\s*\[\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gm;
const EACH_NAME_TEMPLATE =
  /\.each\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

const DESIGN_NUMBER =
  /\b(?:AC|QA-(?!MR-)[A-Z]{1,2})-\d+|(?<![A-Za-z0-9])[A-Z]-\d+\b|^[A-Z]{1,2}\d+[a-z]?:|^T\d |\bStage \d|(?<![\w&])#\d+\b/;

const testNamesIn = (source: string): string[] => [
  ...[...source.matchAll(TEST_NAME)].map(([, , name]) => name ?? ""),
  ...(source.includes(".each")
    ? [
        ...[...source.matchAll(EACH_ROW_LABEL)].map(([, , label]) => label ?? ""),
        ...[...source.matchAll(EACH_NAME_TEMPLATE)].map(([, , name]) => name ?? ""),
      ]
    : []),
];

const testFiles = (): string[] =>
  SOURCE_ROOTS.flatMap((root) => sourceFiles(root)).filter((file) => TEST_FILE.test(file));

describe("test 名は振る舞いの文で書き、repo の外にしか定義の無い番号を持たない", () => {
  test("test 名と .each の行ラベルに設計書の番号が無い (許すのは docs/qa の QA-MR と docs/adr の ADR だけ)", () => {
    const names = testFiles().flatMap((file) =>
      testNamesIn(readFileSync(join(REPO_ROOT, file), "utf8")).map((name) => ({ file, name })),
    );
    expect(names.length).toBeGreaterThan(1000);

    expect(
      names
        .filter(({ name }) => DESIGN_NUMBER.test(name))
        .map(({ file, name }) => `${file}: ${name}`),
    ).toEqual([]);
  });

  test.each([
    "AC-001: 失敗を返す",
    "QA-H-02 事業所を切り替える",
    "F-1 失敗の宣言",
    "G1: token が無い",
    "T1 発行した cookie を読む",
    "Stage 2 ゲート",
    "Hono の route の登録 (#52)",
  ])("設計書の番号として検出する: %s", (name) => {
    expect(DESIGN_NUMBER.test(name)).toBe(true);
  });

  test.each([
    "QA-MR-02 の手順で確かめる",
    "ADR-0017 の境界を守る",
    "C0 制御文字の上端",
    "UTF-8 の文字列",
    "SHA-256 の digest",
    "RFC 6265 の cookie",
  ])("repo の中に定義のある番号と一般の用語は検出しない: %s", (name) => {
    expect(DESIGN_NUMBER.test(name)).toBe(false);
  });
});
