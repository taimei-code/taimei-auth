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

const MOVED_DIRS = ["web/src/membership", "web/src/invitation"];

const MEMBERS_HEADING = "メンバー";

const membersPages = (): string[] =>
  gitFiles(":(glob)web/src/*/pages/*.ts").filter((path) => {
    const source = read(path);
    return (
      importsFoldkit(source) &&
      /export const update\b/.test(source) &&
      source.includes(`"${MEMBERS_HEADING}"`)
    );
  });

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

const INTEGRATION_BRANCH_BASE = "8f72031ad";

describe("メンバーの画面の e2e", () => {
  test("AC-005: e2e に test.fixme を書かない", () => {
    expect(gitGrep(String.raw`test\.fixme\(`, "e2e")).toEqual([]);
  });

  test("AC-006: 統合の branch からの e2e の差分は、test.fixme を test にした行と locator の行だけで、新しい e2e の file を足さない", () => {
    const normalize = (source: string) =>
      source
        .replaceAll("test.fixme(", "test(")
        .replace(/\s+/g, "")
        .replace(/,([}\])])/g, "$1");
    const changed = run("git", ["diff", "--name-only", INTEGRATION_BRANCH_BASE, "--", "e2e/"])
      .stdout.split("\n")
      .filter((line) => line !== "");
    const untracked = gitFiles("e2e/").filter(
      (path) => run("git", ["cat-file", "-e", `${INTEGRATION_BRANCH_BASE}:${path}`]).status !== 0,
    );
    expect(untracked).toEqual([]);
    expect(changed.length).toBeGreaterThan(0);
    const isLocatorLine = (line: string) => /getBy|locator\(/.test(line);
    for (const path of changed) {
      const before = run("git", ["show", `${INTEGRATION_BRANCH_BASE}:${path}`]).stdout;
      const after = existsSync(join(REPO_ROOT, path)) ? read(path) : "";
      if (normalize(before) === normalize(after)) {
        continue;
      }
      const diffLines = run("git", ["diff", "-U0", "-w", INTEGRATION_BRANCH_BASE, "--", path])
        .stdout.split("\n")
        .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
      const added = new Set(diffLines.filter((line) => line.startsWith("+")).map((l) => l.slice(1)));
      const unexplained = diffLines.filter((line) => {
        const body = line.slice(1);
        if (isLocatorLine(body)) {
          return false;
        }
        if (line.startsWith("-") && body.includes("test.fixme(")) {
          return !added.has(body.replace("test.fixme(", "test("));
        }
        if (line.startsWith("+")) {
          return !diffLines.some(
            (removed) =>
              removed.startsWith("-") && removed.slice(1).replace("test.fixme(", "test(") === body,
          );
        }
        return true;
      });
      expect({ path, unexplained }).toEqual({ path, unexplained: [] });
    }
  });
});

describe("page の Story テストと Scene テスト", () => {
  test("AC-007: メンバーを描く Foldkit の page があり、__tests__ に Story テストと Scene テストがあり、bun test で通る", () => {
    const pages = membersPages();
    expect(pages.length).toBe(1);
    const tests = pages.flatMap((page) => {
      const { story, scene } = storyAndSceneTestsOf(page);
      return [story, scene];
    });
    expect(tests.filter((path) => !existsSync(join(REPO_ROOT, path)))).toEqual([]);
    const result = run("bun", ["test", ...tests.map((path) => `./${path}`)]);
    expect(result.status).toBe(0);
  });

  test("AC-008: メンバーの page の Story テストは、二重の操作と古い応答の test を持つ", () => {
    const pages = membersPages();
    expect(pages.length).toBe(1);
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

  test("AC-009: メンバーの page は Model・Message・init・update・view を直接 export し、membership と invitation に index.ts が無い", () => {
    const pages = membersPages();
    expect(pages.length).toBe(1);
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
  test("AC-010: web/src の ts と tsx に、メンバーの画面の React の code を書かない", () => {
    expect(
      gitGrep(
        wordPattern(
          "MemberList|InviteMemberForm|PendingInvitations|ConfirmDestructiveDialog|membersOf|useChangeRole|useRemoveMember|useCreateInvitation|useRevokeInvitation|pendingInvitationsOf|useSelfUserId|CurrentCompanyProvider|useCurrentCompany|companyStateAtom|COMPANY_STATE_KEY|getRouteApi",
        ),
        ":(glob)web/src/**/*.ts",
        ":(glob)web/src/**/*.tsx",
      ),
    ).toEqual([]);
  });
});

describe("期待される失敗と共通ログイン画面への移動", () => {
  test("AC-012: membership と invitation の test 以外の file で、共通ログイン画面への移動を使わない", () => {
    expect(
      nonTestHits(gitGrep(wordPattern("leaveSpaToSignIn") + "|document-navigation", ...MOVED_DIRS)),
    ).toEqual([]);
  });

  test("AC-013: membership と invitation の test 以外の file に Effect.die・Effect.orDie を書かない", () => {
    expect(
      nonTestHits(
        gitGrep(String.raw`(^|[^A-Za-z0-9_.])Effect\.(die|orDie)([^A-Za-z0-9_]|$)`, ...MOVED_DIRS),
      ),
    ).toEqual([]);
  });

  test("AC-014: web/src と web/non-production に page や application を作る独自の関数を書かない", () => {
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
  test("AC-015: 契機の path はメンバーの画面の消した React の file を挙げず、契機の検査が通る", () => {
    const triggerLines = read("docs/qa/manual-regression.md")
      .split("\n")
      .filter((line) => line.includes("契機の path"));
    const removed = [
      "MemberList.tsx",
      "InviteMemberForm.tsx",
      "PendingInvitations.tsx",
      "Members.tsx",
      "membership-atom.ts",
      "invitation-atom.ts",
    ];
    expect(
      triggerLines.filter((line) => removed.some((name) => line.includes(name))),
    ).toEqual([]);
    const result = run("bun", ["test", "src/__tests__/manual-regression-triggers.test.ts"]);
    expect(result.status).toBe(0);
  });
});

type LintCase = { readonly path: string; readonly source: string };

const MODULE_LET_SOURCE =
  'import { Command } from "foldkit";\nexport let counter = 0;\nexport { Command };\n';

const RAW_ELEMENTS_SOURCE =
  'import type { HtmlBuilder } from "foldkit/html";\nexport const button = <M>(h: HtmlBuilder<M>) => h.button([], ["x"]);\nexport const select = <M>(h: HtmlBuilder<M>) => h.select([], []);\n';

const LINT_DIRS = [
  "web/src/membership/pages",
  "web/src/membership",
  "web/src/invitation",
];

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
  lintFixtureDir = mkdtempSync(join(tmpdir(), "acceptance-oxlint-394-"));
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

describe("oxlint はメンバーの画面に効く", () => {
  test("AC-011: membership と invitation の foldkit の file の module の let と h.button・h.select を error にし、メンバーの page と同じ domain の file に error を出さない", () => {
    for (const lintCase of LINT_CASES) {
      expect({ path: lintCase.path, errors: (fixtureErrorsByPath.get(lintCase.path)?.size ?? 0) > 0 })
        .toEqual({ path: lintCase.path, errors: true });
    }
    const pages = membersPages();
    expect(pages.length).toBe(1);
    const children = MOVED_DIRS.flatMap((dir) => gitFiles(`${dir}/*.ts`)).filter(
      (path) => !isTestPath(path) && importsFoldkit(read(path)),
    );
    const errors = new Map<string, Set<string>>();
    collectErrors(oxlintJson(REPO_ROOT, ...new Set([...pages, ...children])), errors);
    expect([...errors.entries()].map(([path, codes]) => [path, [...codes]])).toEqual([]);
  });
});
