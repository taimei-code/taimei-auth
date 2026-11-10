import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const run = (command: string, args: string[]) =>
  spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8" });

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] =>
  run("git", ["grep", "-n", "-E", "--untracked", pattern, "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "");

const gitGrepFixed = (text: string, ...pathspecs: string[]): string[] =>
  run("git", ["grep", "-n", "-F", "--untracked", text, "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "");

const gitFiles = (...pathspecs: string[]): string[] =>
  run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "" && existsSync(join(REPO_ROOT, line)));

const wordPattern = (alternatives: string) =>
  `(^|[^A-Za-z0-9_])(${alternatives})([^A-Za-z0-9_]|$)`;

const pathOfHit = (line: string) => line.split(":")[0] ?? "";

const isTestPath = (path: string) => path.includes("/__tests__/") || /\.test\.tsx?$/.test(path);

const nonTestHits = (lines: string[]) => lines.filter((line) => !isTestPath(pathOfHit(line)));

const importsFoldkit = (source: string) => /from\s+["']foldkit(\/[^"']*)?["']/.test(source);

const MOVED_DIRS = ["web/src/company", "web/src/membership", "web/src/mfa", "web/src/account"];

const foldkitPagesDrawing = (heading: string): string[] =>
  gitFiles(":(glob)web/src/*/pages/*.ts").filter((path) => {
    const source = read(path);
    return (
      importsFoldkit(source) &&
      /export const update\b/.test(source) &&
      source.includes(`"${heading}"`)
    );
  });

const MOVED_PAGE_HEADINGS = ["所属事業所", "事業所設定", "セキュリティ"];

const movedPages = () => MOVED_PAGE_HEADINGS.flatMap(foldkitPagesDrawing);

const storyAndSceneTestsOf = (page: string) => {
  const name = basename(page, ".ts");
  const testsDir = join(dirname(dirname(page)), "__tests__");
  return {
    story: join(testsDir, `${name}.story.test.ts`),
    scene: join(testsDir, `${name}.scene.test.ts`),
  };
};

const testNamesIn = (path: string): string[] =>
  [...read(path).matchAll(/\btest(?:\.each\([\s\S]*?\))?\(\s*["'`]([^"'`]+)["'`]/g)].map(
    ([, name]) => name ?? "",
  );

const MIGRATED_E2E = [
  "e2e/company-mutation.e2e.ts",
  "e2e/company-delete.e2e.ts",
  "e2e/company-leave.e2e.ts",
  "e2e/mfa-flow.e2e.ts",
];

describe("移した画面の e2e", () => {
  test("AC-005: 移した画面の e2e の file に test.fixme を書かない", () => {
    expect(gitGrep(String.raw`test\.fixme\(`, ...MIGRATED_E2E)).toEqual([]);
  });
});

describe("MFA の失敗の文言", () => {
  test("AC-008: web/src の test 以外で、MFA の失敗の文言を mfa-failure-messages.ts の外に書かない", () => {
    const texts = [
      "入力されたコードが正しくありません。",
      "試行回数が上限に達したか",
      "登録情報が更新されました。",
      "はすでに有効です。",
    ];
    const hits = texts.flatMap((text) => nonTestHits(gitGrepFixed(text, "web/src")));
    expect(
      hits.map(pathOfHit).filter((path) => path !== "web/src/mfa/mfa-failure-messages.ts"),
    ).toEqual([]);
  });
});

describe("page ごとの Story テストと Scene テスト", () => {
  test("AC-009: 所属事業所・事業所設定・セキュリティを描く Foldkit の page ごとに、__tests__ に Story テストと Scene テストがあり、bun test で通る", () => {
    for (const heading of MOVED_PAGE_HEADINGS) {
      expect({ heading, pages: foldkitPagesDrawing(heading).length }).toEqual({
        heading,
        pages: 1,
      });
    }
    const tests = movedPages().flatMap((page) => {
      const { story, scene } = storyAndSceneTestsOf(page);
      return [story, scene];
    });
    expect(tests.filter((path) => !existsSync(join(REPO_ROOT, path)))).toEqual([]);
    const result = run("bun", ["test", ...tests.map((path) => `./${path}`)]);
    expect(result.status).toBe(0);
  });

  test("AC-010: 所属事業所・事業所設定・セキュリティの page の Story テストは、それぞれ二重の操作と古い応答の test を持つ", () => {
    const pages = movedPages();
    expect(pages.length).toBe(MOVED_PAGE_HEADINGS.length);
    for (const page of pages) {
      const { story } = storyAndSceneTestsOf(page);
      const names = existsSync(join(REPO_ROOT, story)) ? testNamesIn(story) : [];
      expect({ page, double: names.some((name) => name.includes("二重")) }).toEqual({
        page,
        double: true,
      });
      expect({ page, stale: names.some((name) => name.includes("古い")) }).toEqual({
        page,
        stale: true,
      });
    }
  });

  test("AC-011: 所属事業所・事業所設定・セキュリティの page は Model・Message・init・update・view を直接 export し、domain に index.ts が無い", () => {
    const pages = movedPages();
    expect(pages.length).toBe(MOVED_PAGE_HEADINGS.length);
    for (const page of pages) {
      const source = read(page);
      for (const name of ["Model", "Message", "init", "update", "view"]) {
        expect({ page, name, exported: new RegExp(String.raw`export const ${name}\b`).test(source) })
          .toEqual({ page, name, exported: true });
      }
    }
    expect(gitFiles(...MOVED_DIRS.map((dir) => `${dir}/index.ts`))).toEqual([]);
  });
});

describe("移した画面の React の code", () => {
  test("AC-012: web/src に移した事業所とセキュリティの画面の React の code を書かない", () => {
    expect(
      gitGrep(
        wordPattern(
          "AddCompanyDialog|CompanySettingsForm|OrgCodeField|useAddCompany|useUpdateCompany|useDeleteCompany|leaveCompanyOutcome|useSwitchCompany|useSwitchCompanyRequest|TransferOwnershipModal|useTransferOwnership|MfaEnrollDialog|MfaDisableDialog|MfaSettingsItem|useEnrollMfa|useActivateMfa|useDisableMfa|mfaStatusAtom|useMfaCodeEntry|useMfaCodeInput|oneAtATime|mfaFailureMessage",
        ),
        "web/src",
      ),
    ).toEqual([]);
  });
});

describe("期待される失敗と共通ログイン画面への移動", () => {
  test("AC-014: 移した domain の test 以外の file で、共通ログイン画面への移動を使わない", () => {
    expect(
      nonTestHits(gitGrep(wordPattern("leaveSpaToSignIn") + "|document-navigation", ...MOVED_DIRS)),
    ).toEqual([]);
  });

  test("AC-015: 移した domain の test 以外の file に Effect.die・Effect.orDie を書かない", () => {
    expect(
      nonTestHits(
        gitGrep(String.raw`(^|[^A-Za-z0-9_.])Effect\.(die|orDie)([^A-Za-z0-9_]|$)`, ...MOVED_DIRS),
      ),
    ).toEqual([]);
  });

  test("AC-016: web/src と web/non-production に page や application を作る独自の関数を書かない", () => {
    expect(
      gitGrep(
        wordPattern("definePage|defineElement|startRoutingApplication"),
        "web/src",
        "web/non-production",
      ),
    ).toEqual([]);
  });
});

describe("手動回帰の契機", () => {
  const triggerPathsOf = (id: string): string[] => {
    const section = read("docs/qa/manual-regression.md")
      .split(/^## /m)
      .find((part) => part.startsWith(`${id}:`));
    const triggerLine = /^- \*\*契機の path\*\*: (.+)$/m.exec(section ?? "")?.[1] ?? "";
    return [...triggerLine.matchAll(/`([^`]+)`/g)].map(([, glob]) => glob ?? "");
  };

  const listsExistingFileContaining = (paths: string[], text: string) =>
    paths.some(
      (path) =>
        path.startsWith("web/src/") &&
        existsSync(join(REPO_ROOT, path)) &&
        read(path).includes(text),
    );

  test("AC-017: QA-MR-06・08 の契機の path は消した React の file を挙げず、移した file を挙げ、契機の検査が通る", () => {
    const removed = ["web/src/mfa/MfaEnrollDialog.tsx", "web/src/mfa/use-mfa-code-entry.ts"];
    const mr06 = triggerPathsOf("QA-MR-06");
    const mr08 = triggerPathsOf("QA-MR-08");
    expect([...mr06, ...mr08].filter((path) => removed.includes(path))).toEqual([]);
    expect(listsExistingFileContaining(mr06, "認証アプリで読み取る QR コード")).toBe(true);
    expect(listsExistingFileContaining(mr08, "mfa-enroll-code")).toBe(true);
    expect(listsExistingFileContaining(mr08, "mfa-disable-code")).toBe(true);
    const result = run("bun", ["test", "src/__tests__/manual-regression-triggers.test.ts"]);
    expect(result.status).toBe(0);
  });
});

type LintCase = { readonly path: string; readonly source: string };

const MODULE_LET_SOURCE =
  'import { Command } from "foldkit";\nexport let counter = 0;\nexport { Command };\n';

const RAW_ELEMENTS_SOURCE =
  'import type { HtmlBuilder } from "foldkit/html";\nexport const button = <M>(h: HtmlBuilder<M>) => h.button([], ["x"]);\nexport const select = <M>(h: HtmlBuilder<M>) => h.select([], []);\n';

const LINT_DIRS = ["web/src/company/pages", "web/src/company", "web/src/membership", "web/src/mfa"];

const LINT_CASES: LintCase[] = LINT_DIRS.flatMap((dir) => [
  { path: `${dir}/ModuleLetProbe.ts`, source: MODULE_LET_SOURCE },
  { path: `${dir}/RawElementsProbe.ts`, source: RAW_ELEMENTS_SOURCE },
]);

type Diagnostic = { readonly filename: string; readonly severity: string; readonly code?: string };

const fixtureErrorsByPath = new Map<string, Set<string>>();
let lintFixtureDir = "";

const collectErrors = (diagnostics: readonly Diagnostic[], into: Map<string, Set<string>>) => {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      const codes = into.get(diagnostic.filename) ?? new Set<string>();
      codes.add(diagnostic.code ?? "");
      into.set(diagnostic.filename, codes);
    }
  }
};

const repoConfigForFixture = (): string => {
  const config: { jsPlugins?: Array<string | { name: string; specifier: string }> } = JSON.parse(
    read(".oxlintrc.json"),
  );
  const absolute = (specifier: string) =>
    specifier.startsWith(".") ? join(REPO_ROOT, specifier) : specifier;
  const jsPlugins = (config.jsPlugins ?? []).map((plugin) =>
    typeof plugin === "string"
      ? absolute(plugin)
      : { ...plugin, specifier: absolute(plugin.specifier) },
  );
  return JSON.stringify({ ...config, jsPlugins });
};

const oxlintJson = (cwd: string, ...targets: string[]): Diagnostic[] => {
  const result = spawnSync(
    join(REPO_ROOT, "node_modules/.bin/oxlint"),
    ["--disable-nested-config", "--format", "json", ...targets],
    { cwd, encoding: "utf8" },
  );
  const report: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  return report.diagnostics;
};

beforeAll(() => {
  lintFixtureDir = mkdtempSync(join(tmpdir(), "acceptance-oxlint-391-393-"));
  writeFileSync(join(lintFixtureDir, ".oxlintrc.json"), repoConfigForFixture());
  symlinkSync(join(REPO_ROOT, "node_modules"), join(lintFixtureDir, "node_modules"));
  for (const { path, source } of LINT_CASES) {
    mkdirSync(dirname(join(lintFixtureDir, path)), { recursive: true });
    writeFileSync(join(lintFixtureDir, path), source);
  }
  collectErrors(oxlintJson(lintFixtureDir, "web"), fixtureErrorsByPath);
});

afterAll(() => {
  if (lintFixtureDir !== "") {
    rmSync(lintFixtureDir, { recursive: true, force: true });
  }
});

describe("oxlint は移した画面に効く", () => {
  test("AC-013: 移した domain の foldkit の file の module の let と h.button・h.select を error にし、移した page と子に error を出さない", () => {
    for (const lintCase of LINT_CASES) {
      expect({ path: lintCase.path, errors: (fixtureErrorsByPath.get(lintCase.path)?.size ?? 0) > 0 })
        .toEqual({ path: lintCase.path, errors: true });
    }
    const pages = movedPages();
    expect(pages.length).toBe(MOVED_PAGE_HEADINGS.length);
    const children = MOVED_DIRS.flatMap((dir) => gitFiles(`${dir}/*.ts`)).filter(
      (path) => !isTestPath(path) && importsFoldkit(read(path)),
    );
    const errors = new Map<string, Set<string>>();
    collectErrors(oxlintJson(REPO_ROOT, ...new Set([...pages, ...children])), errors);
    expect([...errors.entries()].map(([path, codes]) => [path, [...codes]])).toEqual([]);
  });
});
