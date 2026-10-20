import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { REPO_ROOT, repoFiles, SOURCE_ROOTS, sourceFiles, valueImportsOf } from "./source-scan";

const RULE_NUMBER_REFERENCE = /CLAUDE\.md`? ルール ?[0-9]/;
const HEADING_REFERENCE = /([\w./-]*CLAUDE\.md)`?(?: の)?「([^」]+)」/g;
const HEADING = /^#{1,6} (.+)$/gm;
const SCAN_HELPERS = /(^|\/)(source-scan|config-invariant-helpers)$/;
const TEST_PATH = /`([^`\s]*\/[^`\s]*\.test\.tsx?)`/g;

type RepoText = { readonly path: string; readonly text: string };

const repoTexts = (...pathspecs: string[]): RepoText[] =>
  repoFiles(...pathspecs)
    .filter((path) => lstatSync(join(REPO_ROOT, path), { throwIfNoEntry: false })?.isFile())
    .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), "utf8") }));

const headingsOf = (path: string): string[] =>
  existsSync(join(REPO_ROOT, path))
    ? [...readFileSync(join(REPO_ROOT, path), "utf8").matchAll(HEADING)].map(([, heading]) =>
        (heading ?? "").trim(),
      )
    : [];

const missingHeadings = (texts: readonly RepoText[]): string[] =>
  texts.flatMap(({ path, text }) =>
    [...text.matchAll(HEADING_REFERENCE)]
      .filter(
        ([, document = "", heading = ""]) =>
          !resolvesTo({ path, text }, document).some((candidate) =>
            headingsOf(candidate).includes(heading),
          ),
      )
      .map(([reference]) => `${path}: ${reference}`),
  );

const ruleDocuments = (): RepoText[] => repoTexts(":(glob)**/CLAUDE.md", ":(glob)docs/adr/*.md");

const mentionedTestPaths = (document: RepoText): string[] =>
  [...document.text.matchAll(TEST_PATH)].map(([, mentioned]) => mentioned ?? "");

const resolvesTo = (document: RepoText, mentioned: string): string[] => [
  normalize(mentioned),
  normalize(join(dirname(document.path), mentioned)),
];

const staticChecks = (): string[] =>
  SOURCE_ROOTS.flatMap((root) => sourceFiles(root, { tests: "only" }))
    .filter((file) => /\.test\.tsx?$/.test(file))
    .filter((file) => valueImportsOf(file).some((imported) => SCAN_HELPERS.test(imported)));

const unnamedChecks = (checks: readonly string[], documents: readonly RepoText[]) => {
  const named = new Set(
    documents.flatMap((document) =>
      mentionedTestPaths(document).flatMap((mentioned) => resolvesTo(document, mentioned)),
    ),
  );
  return checks.filter((check) => !named.has(check));
};

const missingMentions = (documents: readonly RepoText[]) =>
  documents.flatMap((document) =>
    mentionedTestPaths(document)
      .filter((mentioned) =>
        resolvesTo(document, mentioned).every((path) => !existsSync(join(REPO_ROOT, path))),
      )
      .map((mentioned) => `${document.path}: ${mentioned}`),
  );

describe("規則から静的な検査へ 1 hop で着く", () => {
  test("source を走査する検査 (source-scan か config-invariant-helpers を使う test) は、どれかの CLAUDE.md か ADR が path で名指す", () => {
    const checks = staticChecks();
    expect(checks.length).toBeGreaterThan(10);

    expect(unnamedChecks(checks, ruleDocuments())).toEqual([]);
  });

  test("文書への参照は CLAUDE.md の規則の番号でなく見出しで書く", () => {
    expect(
      repoTexts()
        .filter(({ text }) => RULE_NUMBER_REFERENCE.test(text))
        .map(({ path }) => path),
    ).toEqual([]);
  });

  test("CLAUDE.md の見出しへの参照は、その file に実在する見出しを指す", () => {
    expect(missingHeadings(repoTexts())).toEqual([]);
  });

  test("CLAUDE.md が path で名指す test file は存在する", () => {
    expect(
      missingMentions(ruleDocuments().filter(({ path }) => path.endsWith("CLAUDE.md"))),
    ).toEqual([]);
  });
});
