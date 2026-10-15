import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { REPO_ROOT, repoFiles, SOURCE_ROOTS, sourceFiles, valueImportsOf } from "./source-scan";

const SCAN_HELPERS = /(^|\/)(source-scan|config-invariant-helpers)$/;
const TEST_PATH = /`([^`\s]*\/[^`\s]*\.test\.tsx?)`/g;

type RuleDocument = { readonly path: string; readonly text: string };

const ruleDocuments = (): RuleDocument[] =>
  repoFiles(":(glob)**/CLAUDE.md", ":(glob)docs/adr/*.md").map((path) => ({
    path,
    text: readFileSync(join(REPO_ROOT, path), "utf8"),
  }));

const mentionedTestPaths = (document: RuleDocument): string[] =>
  [...document.text.matchAll(TEST_PATH)].map(([, mentioned]) => mentioned ?? "");

const resolvesTo = (document: RuleDocument, mentioned: string): string[] => [
  normalize(mentioned),
  normalize(join(dirname(document.path), mentioned)),
];

const staticChecks = (): string[] =>
  SOURCE_ROOTS.flatMap((root) => sourceFiles(root, { tests: "only" }))
    .filter((file) => /\.test\.tsx?$/.test(file))
    .filter((file) => valueImportsOf(file).some((imported) => SCAN_HELPERS.test(imported)));

const unnamedChecks = (checks: readonly string[], documents: readonly RuleDocument[]) => {
  const named = new Set(
    documents.flatMap((document) =>
      mentionedTestPaths(document).flatMap((mentioned) => resolvesTo(document, mentioned)),
    ),
  );
  return checks.filter((check) => !named.has(check));
};

const missingMentions = (documents: readonly RuleDocument[]) =>
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

  test("CLAUDE.md が path で名指す test file は存在する", () => {
    expect(
      missingMentions(ruleDocuments().filter(({ path }) => path.endsWith("CLAUDE.md"))),
    ).toEqual([]);
  });
});
