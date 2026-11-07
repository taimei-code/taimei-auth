import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const OXLINT = join(REPO_ROOT, "node_modules/.bin/oxlint");

type Case = {
  readonly name: string;
  readonly path: string;
  readonly source: string;
  readonly expectedRules: readonly string[];
};

const RESTRICTED_IMPORT = "eslint(no-restricted-imports)";
const RESTRICTED_GLOBAL = "eslint(no-restricted-globals)";
const MISSING_EXTENSION = "import(extensions)";
const TEMPLATE_PLACEHOLDER_IN_STRING = "eslint(no-template-curly-in-string)";
const DANGEROUS_INNER_HTML = "react(no-danger)";
const TARGET_BLANK_WITHOUT_NOOPENER = "react(jsx-no-target-blank)";
const EVAL = "eslint(no-eval)";
const EMPTY_HEADING = "jsx-a11y(heading-has-content)";
const ARIA_HIDDEN_ON_FOCUSABLE = "jsx-a11y(no-aria-hidden-on-focusable)";
const BUTTON_WITHOUT_TYPE = "react(button-has-type)";
const LOOSE_EQUALITY = "eslint(eqeqeq)";
const SWITCH_FALLTHROUGH = "eslint(no-fallthrough)";
const PARSE_INT_WITHOUT_RADIX = "eslint(radix)";
const COMMONJS = "import(no-commonjs)";
const EFFECT_RUN_IN_WEB = "taimei(no-effect-run-in-web)";
const BROWSER_GLOBAL_OUTSIDE_COMMAND = "taimei(no-browser-global-outside-command)";

const CASES: readonly Case[] = [
  {
    name: "server は web 専用の依存を import できない",
    path: "src/handlers/web-only.ts",
    source: 'import "lucide-react";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "db は web 専用の依存を import できない",
    path: "db/web-only.ts",
    source: 'import "@radix-ui/react-dialog";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "management は削除済みの connect-node を import できない",
    path: "management/connect-node.ts",
    source: 'import "@connectrpc/connect-node";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "testing は effect の subpath を import できない",
    path: "testing/effect-subpath.ts",
    source: 'import "effect/Schema";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "src は drizzle-orm を直接 import できない",
    path: "src/drizzle.ts",
    source: 'import "drizzle-orm";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "src は @/db/client を直接 import できない",
    path: "src/db-client.ts",
    source: 'import "@/db/client";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "src は @/db/schema を直接 import できない",
    path: "src/db-schema.ts",
    source: 'import "@/db/schema";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "src は getSessionCookie を import できない",
    path: "src/cookie.ts",
    source: 'import { getSessionCookie } from "better-auth/cookies"; export { getSessionCookie };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "src は better-auth/cookies の getSessionCookie 以外を import できる",
    path: "src/cookie-other.ts",
    source:
      'import { createAuthCookieGetter } from "better-auth/cookies"; export { createAuthCookieGetter };',
    expectedRules: [],
  },
  {
    name: "src/auth.ts は drizzle-orm を import できる",
    path: "src/auth.ts",
    source: 'import "drizzle-orm";',
    expectedRules: [],
  },
  {
    name: "src の test は drizzle-orm を import できる",
    path: "src/__tests__/drizzle.test.ts",
    source: 'import "drizzle-orm";',
    expectedRules: [],
  },
  {
    name: "testing の test は drizzle-orm を import できる",
    path: "testing/__tests__/drizzle.test.ts",
    source: 'import "drizzle-orm";',
    expectedRules: [],
  },
  {
    name: "src の test も web 専用の依存は import できない",
    path: "src/__tests__/web-only.test.ts",
    source: 'import "sonner";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "契約は HttpApiBuilder を import できない",
    path: "src/account-contract.ts",
    source: 'import { HttpApiBuilder } from "effect/http-api"; export { HttpApiBuilder };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "契約は effect/http-api の HttpApi を import できる",
    path: "src/company-contract.ts",
    source: 'import { HttpApi } from "effect/http-api"; export { HttpApi };',
    expectedRules: [],
  },
  {
    name: "契約は effect/http を import できない",
    path: "src/session-contract.ts",
    source: 'import "effect/http";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "契約の表も web 専用の依存を import できない",
    path: "src/spa-contract-table.ts",
    source: 'import "clsx";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "Hono に載せる実装は effect/http を import できる",
    path: "src/handlers/account-http-api.ts",
    source: 'import "effect/http";',
    expectedRules: [],
  },
  {
    name: "Hono に載せる実装は effect/sql を import できない",
    path: "src/handlers/company-http-api.ts",
    source: 'import "effect/sql";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "Hono に載せる実装は drizzle-orm を import できない",
    path: "src/handlers/session-http-api.ts",
    source: 'import "drizzle-orm";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "e2e の spec は pg を import できない",
    path: "e2e/pg.spec.ts",
    source: 'import "pg";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "e2e の spec は db を相対 path で import できない",
    path: "e2e/db.spec.ts",
    source: 'import "../db/schema";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "e2e の spec は effect を import できない",
    path: "e2e/effect.spec.ts",
    source: 'import "effect";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "e2e/fixtures.ts は pg を import できる",
    path: "e2e/fixtures.ts",
    source: 'import "pg";',
    expectedRules: [],
  },
  {
    name: "web は sonner を直接 import できない",
    path: "web/src/account/sonner.ts",
    source: 'import "sonner";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "web/src/shared/notify.tsx は sonner を import できる",
    path: "web/src/shared/notify.tsx",
    source: 'import "sonner";',
    expectedRules: [],
  },
  {
    name: "notify.tsx も pg は import できない",
    path: "web/src/shared/notify.tsx",
    source: 'import "pg";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "web は effect/reactivity を import できる",
    path: "web/src/account/reactivity.ts",
    source: 'import "effect/reactivity";',
    expectedRules: [],
  },
  {
    name: "web は effect/http を import できる",
    path: "web/src/account/http.ts",
    source: 'import "effect/http";',
    expectedRules: [],
  },
  {
    name: "web はほかの effect の subpath を import できない",
    path: "web/src/account/schema.ts",
    source: 'import "effect/Schema";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "web は drizzle-orm の subpath を import できない",
    path: "web/src/account/pg-core.ts",
    source: 'import "drizzle-orm/pg-core";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "web は pg を import できない",
    path: "web/non-production/pg.ts",
    source: 'import "pg";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "web の page は URLSearchParams を使えない",
    path: "web/src/auth/search.ts",
    source: 'export const params = new URLSearchParams("");',
    expectedRules: [RESTRICTED_GLOBAL],
  },
  {
    name: "web/src/app/search-params.ts は URLSearchParams を使える",
    path: "web/src/app/search-params.ts",
    source: 'export const params = new URLSearchParams("");',
    expectedRules: [],
  },
  {
    name: "web の test は URLSearchParams を使える",
    path: "web/src/auth/__tests__/search.test.ts",
    source: 'export const params = new URLSearchParams("");',
    expectedRules: [],
  },
  {
    name: "SDK は react を import できない",
    path: "packages/auth-client/src/react.ts",
    source: 'import "react";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "SDK は next/headers を import できない",
    path: "packages/auth-client/src/next.ts",
    source: 'import "next/headers";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "SDK の testing.ts は拡張子の無い相対 import を書けない",
    path: "packages/auth-client/src/testing.ts",
    source: 'import "./types";',
    expectedRules: [MISSING_EXTENSION],
  },
  {
    name: "SDK の testing.ts は拡張子の無い相対 path から型を import できない",
    path: "packages/auth-client/src/testing.ts",
    source: 'import type { Types } from "./types"; export type { Types };',
    expectedRules: [MISSING_EXTENSION],
  },
  {
    name: "SDK の testing.ts は拡張子の無い相対 path から型を re-export できない",
    path: "packages/auth-client/src/testing.ts",
    source: 'export type { Types } from "./types";',
    expectedRules: [MISSING_EXTENSION],
  },
  {
    name: "SDK の testing.ts 以外は拡張子の無い相対 import を書ける",
    path: "packages/auth-client/src/index.ts",
    source: 'import "./types";',
    expectedRules: [],
  },
  {
    name: "通常の文字列に template の置換を書けない",
    path: "src/curly.ts",
    source: `export const text = "$${"{"}value}";`,
    expectedRules: [TEMPLATE_PLACEHOLDER_IN_STRING],
  },
  {
    name: "画面は dangerouslySetInnerHTML を書けない",
    path: "web/src/account/inner-html.tsx",
    source:
      "export const View = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />;",
    expectedRules: [DANGEROUS_INNER_HTML],
  },
  {
    name: "画面は rel の noreferrer の無い target=_blank の link を書けない",
    path: "web/src/account/blank.tsx",
    source: 'export const View = () => <a href="https://example.com" target="_blank">x</a>;',
    expectedRules: [TARGET_BLANK_WITHOUT_NOOPENER],
  },
  {
    name: "画面は文字の無い見出しを書けない",
    path: "web/src/account/heading.tsx",
    source: "export const View = () => <h2 />;",
    expectedRules: [EMPTY_HEADING],
  },
  {
    name: "画面は focus を受ける要素を aria-hidden で隠せない",
    path: "web/src/account/hidden-button.tsx",
    source: 'export const View = () => <button type="button" aria-hidden="true">x</button>;',
    expectedRules: [ARIA_HIDDEN_ON_FOCUSABLE],
  },
  {
    name: "画面は type の無い button を書けない",
    path: "web/src/account/untyped-button.tsx",
    source: "export const View = () => <button>x</button>;",
    expectedRules: [BUTTON_WITHOUT_TYPE],
  },
  {
    name: "Foldkit の画面の update は timer を始められない",
    path: "web/src/mfa/timer-in-update.ts",
    source:
      'import { Command } from "foldkit"; export const update = (ms: number) => { setTimeout(() => undefined, ms); return Command; };',
    expectedRules: [BROWSER_GLOBAL_OUTSIDE_COMMAND],
  },
  {
    name: "Foldkit の画面の view は window を読めない",
    path: "web/src/mfa/window-in-view.ts",
    source:
      'import { Command } from "foldkit"; export const view = () => [window.location.href, Command];',
    expectedRules: [BROWSER_GLOBAL_OUTSIDE_COMMAND],
  },
  {
    name: "Foldkit の Command の execute は、Effect の中で window を使える",
    path: "web/src/mfa/window-in-command.ts",
    source:
      'import { Effect } from "effect"; import { Command } from "foldkit"; export const ScrollToTop = Command.define("ScrollToTop", { messages: [], execute: Effect.sync(() => window.scrollTo(0, 0)) });',
    expectedRules: [],
  },
  {
    name: "web の画面は Effect を自分で走らせない",
    path: "web/src/mfa/run-effect.ts",
    source:
      'import { Effect } from "effect"; export const run = () => Effect.runPromise(Effect.void);',
    expectedRules: [EFFECT_RUN_IN_WEB],
  },
  {
    name: "Foldkit の画面の file も、web の import の禁止を失わない",
    path: "web/src/mfa/notify-program.ts",
    source:
      'import { Command } from "foldkit"; import { toast } from "sonner"; export { Command, toast };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "== で比べられない",
    path: "src/loose-equality.ts",
    source: "export const same = (a: number, b: number) => a == b;",
    expectedRules: [LOOSE_EQUALITY],
  },
  {
    name: "switch の case から次の case へ break なしに進めない",
    path: "src/fallthrough.ts",
    source:
      "export const label = (n: number) => { let text = ''; switch (n) { case 1: text = 'one'; case 2: text += 'two'; break; } return text; };",
    expectedRules: [SWITCH_FALLTHROUGH],
  },
  {
    name: "parseInt に基数を渡さずに呼べない",
    path: "src/parse-int.ts",
    source: "export const parse = (text: string) => parseInt(text);",
    expectedRules: [PARSE_INT_WITHOUT_RADIX],
  },
  {
    name: "require で module を読めない",
    path: "src/commonjs.ts",
    source: 'export const orm = require("drizzle-orm");',
    expectedRules: [COMMONJS],
  },
  {
    name: "eval を書けない",
    path: "src/eval.ts",
    source: "export const run = (code: string) => eval(code);",
    expectedRules: [EVAL],
  },
];

type Diagnostic = { readonly code: string; readonly filename: string };

const groupsWithDistinctPaths = (cases: readonly Case[]): Case[][] =>
  cases.reduce<Case[][]>((groups, testCase) => {
    const group = groups.find((candidate) => candidate.every(({ path }) => path !== testCase.path));
    if (group === undefined) groups.push([testCase]);
    else group.push(testCase);
    return groups;
  }, []);

const configWithJsPluginsFromRepo = (): string => {
  const config = JSON.parse(readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8")) as {
    jsPlugins?: { name: string; specifier: string }[];
  };
  const jsPlugins = (config.jsPlugins ?? []).map((plugin) => ({
    ...plugin,
    specifier: plugin.specifier.startsWith("./")
      ? join(REPO_ROOT, plugin.specifier)
      : join(REPO_ROOT, "node_modules", plugin.specifier),
  }));
  return JSON.stringify({ ...config, jsPlugins });
};

const fixtureDirs: string[] = [];
const lintedFileCounts: { readonly written: number; readonly linted: number }[] = [];
const rulesByCase = new Map<Case, string[]>();

const lintGroup = (group: readonly Case[]): void => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "oxlint-rules-"));
  fixtureDirs.push(fixtureDir);
  writeFileSync(join(fixtureDir, ".oxlintrc.json"), configWithJsPluginsFromRepo());
  mkdirSync(join(fixtureDir, "packages/auth-client/src"), { recursive: true });
  writeFileSync(join(fixtureDir, "packages/auth-client/src/types.ts"), "export type Types = 1;\n");
  for (const { path, source } of group) {
    mkdirSync(dirname(join(fixtureDir, path)), { recursive: true });
    writeFileSync(join(fixtureDir, path), `${source}\n`);
  }
  const result = spawnSync(OXLINT, ["--format", "json", "."], {
    cwd: fixtureDir,
    encoding: "utf8",
  });
  const { diagnostics, number_of_files } = JSON.parse(result.stdout) as {
    diagnostics: Diagnostic[];
    number_of_files: number;
  };
  lintedFileCounts.push({ written: group.length + 1, linted: number_of_files });
  for (const testCase of group) {
    rulesByCase.set(testCase, [
      ...new Set(
        diagnostics.filter(({ filename }) => filename === testCase.path).map(({ code }) => code),
      ),
    ]);
  }
};

beforeAll(() => {
  groupsWithDistinctPaths(CASES).forEach(lintGroup);
});

afterAll(() => {
  for (const fixtureDir of fixtureDirs) rmSync(fixtureDir, { recursive: true, force: true });
});

describe("Biome から写した lint の rule は、oxlint で同じ path に効く", () => {
  test.each([...CASES])("$name", (testCase: Case) => {
    expect(rulesByCase.get(testCase)).toEqual([...testCase.expectedRules]);
  });

  test("fixture の file はすべて oxlint に読まれるので、指摘の無い case は読み飛ばしで通らない", () => {
    expect(lintedFileCounts.map(({ linted }) => linted)).toEqual(
      lintedFileCounts.map(({ written }) => written),
    );
  });
});
