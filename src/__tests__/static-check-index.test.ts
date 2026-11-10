import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import taimeiPlugin from "../../lint/oxlint-plugin.mjs";
import { REPO_ROOT, repoFiles } from "./source-scan";

const RULE_NUMBER_REFERENCE = /CLAUDE\.md`? ルール ?[0-9]/;
const HEADING_REFERENCE = /([\w./-]*CLAUDE\.md)`?(?: の)?「([^」]+)」/g;
const HEADING = /^#{1,6} (.+)$/gm;
const LINT_RULE_NAME_OR_TEST_PATH = /taimei\/[a-z][a-z-]*|[\w./-]+\.test\.tsx?/g;
const RULE_DOCUMENT_BYTES_CEILING = 6883;

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

const ruleDocuments = (): RepoText[] => repoTexts(":(glob)**/CLAUDE.md", ":(exclude)repos/**");

const resolvesTo = (document: RepoText, mentioned: string): string[] => [
  normalize(mentioned),
  normalize(join(dirname(document.path), mentioned)),
];

type RuleSeverities = Readonly<Record<string, unknown>>;

const enabledTaimeiRules = (): string[] => {
  const config: {
    readonly rules: RuleSeverities;
    readonly overrides: ReadonlyArray<{ readonly rules?: RuleSeverities }>;
  } = JSON.parse(readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8"));
  const enabled = [config.rules, ...config.overrides.map(({ rules = {} }) => rules)]
    .flatMap((rules) => Object.entries(rules))
    .filter(([name, severity]) => name.startsWith("taimei/") && severity === "error")
    .map(([name]) => name.slice("taimei/".length));
  return [...new Set(enabled)];
};

describe("規則の正本は違反した時の message と test 名で、CLAUDE.md は担保の写しを持たない (ADR-0027)", () => {
  test("CLAUDE.md は lint の rule 名と test file の path を書かない (型・lint・test が止める規則は、message と test 名が説明する)", () => {
    expect(
      ruleDocuments().flatMap(({ path, text }) =>
        [...text.matchAll(LINT_RULE_NAME_OR_TEST_PATH)].map(([copy]) => `${path}: ${copy}`),
      ),
    ).toEqual([]);
  });

  test("CLAUDE.md の合計 byte は上限以下 (規則を仕組みにして文を消した時だけ、上限を下げる)", () => {
    const documents = ruleDocuments();
    expect(documents.length).toBeGreaterThan(5);
    expect(
      documents.reduce((total, { text }) => total + Buffer.byteLength(text, "utf8"), 0),
    ).toBeLessThanOrEqual(RULE_DOCUMENT_BYTES_CEILING);
  });

  test("lint の plugin が持つ rule と、.oxlintrc.json で error にした taimei の rule は同じ", () => {
    expect(enabledTaimeiRules().toSorted()).toEqual(Object.keys(taimeiPlugin.rules).toSorted());
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

  test("CLAUDE.md と同じ dir に、CLAUDE.md を指す相対 symlink の AGENTS.md がある", () => {
    const withoutAgents = repoFiles(":(glob)**/CLAUDE.md", ":(exclude)repos/**").filter((path) => {
      const agents = join(REPO_ROOT, dirname(path), "AGENTS.md");
      return !(
        lstatSync(agents, { throwIfNoEntry: false })?.isSymbolicLink() &&
        readlinkSync(agents) === "CLAUDE.md"
      );
    });
    expect(withoutAgents).toEqual([]);
  });

  test("追跡している AGENTS.md は、どれも symlink である (CLAUDE.md の無い dir に実 file の AGENTS.md を置かない)", () => {
    expect(
      repoFiles(":(glob)**/AGENTS.md", ":(exclude)repos/**").filter(
        (path) => !lstatSync(join(REPO_ROOT, path)).isSymbolicLink(),
      ),
    ).toEqual([]);
  });
});
