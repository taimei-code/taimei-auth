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
const EVAL = "eslint(no-eval)";
const LOOSE_EQUALITY = "eslint(eqeqeq)";
const SWITCH_FALLTHROUGH = "eslint(no-fallthrough)";
const PARSE_INT_WITHOUT_RADIX = "eslint(radix)";
const COMMONJS = "import(no-commonjs)";
const EFFECT_RUN_IN_WEB = "taimei(no-effect-run-in-web)";
const BROWSER_GLOBAL_OUTSIDE_COMMAND = "taimei(no-browser-global-outside-command)";
const TIMER_CLOCK_RANDOM_IN_FOLDKIT = "taimei(no-timer-clock-random-in-foldkit)";
const ATOM_IMPORT_IN_FOLDKIT = "taimei(no-atom-import-in-foldkit)";
const RAW_FORM_ELEMENT = "taimei(no-raw-form-element)";
const DIRECT_APPLICATION_START = "taimei(no-direct-application-start)";
const MODULE_LEVEL_MUTABLE_STATE = "foldkit(no-module-level-mutable-state)";
const BRACES_REQUIRED = "eslint(curly)";
const TYPE_ASSERTION = "typescript(consistent-type-assertions)";

const CASES: readonly Case[] = [
  {
    name: "web の画面は @foldkit/ui の Dialog を直接 import できない",
    path: "web/src/account/pages/DialogProbe.ts",
    source: 'import { Dialog } from "@foldkit/ui";\nexport { Dialog };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "house の dialog の file は @foldkit/ui の Dialog を import できる",
    path: "web/src/shared/ui/dialog-view.ts",
    source: 'import { Dialog } from "@foldkit/ui";\nexport { Dialog };',
    expectedRules: [],
  },
  {
    name: "house の dialog の file も react は import できない",
    path: "web/src/shared/ui/dialog-view.ts",
    source: 'import "react";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "server は web 専用の依存を import できない",
    path: "src/handlers/web-only.ts",
    source: 'import "foldkit";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "db は web 専用の依存を import できない",
    path: "db/web-only.ts",
    source: 'import "@foldkit/ui";',
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
    source: 'import "lucide";',
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
    name: "web は react を import できない",
    path: "web/src/account/react.ts",
    source: 'import "react";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "web は react-dom の subpath を import できない",
    path: "web/non-production/react-dom.ts",
    source: 'import "react-dom/client";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "web は effect/reactivity を import できない",
    path: "web/src/account/reactivity.ts",
    source: 'import "effect/reactivity";',
    expectedRules: [RESTRICTED_IMPORT],
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
    name: "Foldkit の画面の view は Command の外で window を読めない",
    path: "web/src/mfa/window-in-view.ts",
    source:
      'import { Command } from "foldkit"; export const view = () => [window.location.href, Command];',
    expectedRules: [BROWSER_GLOBAL_OUTSIDE_COMMAND],
  },
  {
    name: "Foldkit の Command の execute は、Effect.sync の中で window を使える",
    path: "web/src/mfa/window-in-command.ts",
    source:
      'import { Effect } from "effect"; import { Command } from "foldkit"; export const ScrollToTop = Command.define("ScrollToTop", { messages: [], execute: Effect.sync(() => window.scrollTo(0, 0)) });',
    expectedRules: [],
  },
  {
    name: "Foldkit の file は timer を使えない",
    path: "web/src/mfa/timer.ts",
    source:
      'import { Command } from "foldkit"; export const later = () => [setTimeout(() => undefined, 1), Command];',
    expectedRules: [TIMER_CLOCK_RANDOM_IN_FOLDKIT],
  },
  {
    name: "Foldkit の file は Date.now を使えない",
    path: "web/src/mfa/date-now.ts",
    source: 'import { Command } from "foldkit"; export const read = () => [Date.now(), Command];',
    expectedRules: ["foldkit(no-impure-call-at-decision-time)", TIMER_CLOCK_RANDOM_IN_FOLDKIT],
  },
  {
    name: "Foldkit の file は *-atom.ts を import できない",
    path: "web/src/mfa/atom-import.ts",
    source:
      'import { Command } from "foldkit"; import { mfaStatusAtom } from "./mfa-atom"; export { Command, mfaStatusAtom };',
    expectedRules: [ATOM_IMPORT_IN_FOLDKIT],
  },
  {
    name: "web の画面は Effect を自分で走らせない",
    path: "web/src/mfa/run-effect.ts",
    source:
      'import { Effect } from "effect"; export const run = () => Effect.runPromise(Effect.void);',
    expectedRules: [EFFECT_RUN_IN_WEB],
  },
  {
    name: "画面は shared/ui の部品を使い、h.button を直に書けない",
    path: "web/src/mfa/raw-button.ts",
    source:
      "type Builder = { readonly button: (attributes: unknown[], children: unknown[]) => unknown }; export const view = (h: Builder) => h.button([], []);",
    expectedRules: [RAW_FORM_ELEMENT],
  },
  {
    name: "shared/ui の部品は h.button を書ける",
    path: "web/src/shared/ui/form-button.ts",
    source:
      "type Builder = { readonly button: (attributes: unknown[], children: unknown[]) => unknown }; export const view = (h: Builder) => h.button([], []);",
    expectedRules: [],
  },
  {
    name: "application は起動の関数の外で起動できない",
    path: "web/src/app/auth/entry.ts",
    source:
      'import { Runtime } from "foldkit"; export const start = (program: Parameters<typeof Runtime.run>[0]) => Runtime.run(program);',
    expectedRules: [DIRECT_APPLICATION_START],
  },
  {
    name: "起動の関数だけが makeApplication と run を呼べる",
    path: "web/src/app/start-application.ts",
    source:
      'import { Runtime } from "foldkit"; export const start = (config: Parameters<typeof Runtime.makeApplication>[0]) => Runtime.run(Runtime.makeApplication(config));',
    expectedRules: [],
  },
  {
    name: "web は @/ で import できない",
    path: "web/src/shared/at-alias.ts",
    source: 'import { cn } from "@/shared/utils"; export { cn };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "route は app/*/route.ts の外で import できない",
    path: "web/src/mfa/route-in-domain.ts",
    source: 'import { literal } from "foldkit/route"; export { literal };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "app/*/route.ts は route を import できる",
    path: "web/src/app/auth/route.ts",
    source:
      'import { Route } from "foldkit"; import { literal } from "foldkit/route"; export { literal, Route };',
    expectedRules: [],
  },
  {
    name: "app/*/route.ts も web の import の禁止を失わない",
    path: "web/src/app/account/route.ts",
    source: 'import { useState } from "react"; export { useState };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "Foldkit の画面の file も、web の import の禁止を失わない",
    path: "web/src/mfa/react-program.ts",
    source:
      'import { Command } from "foldkit"; import { useState } from "react"; export { Command, useState };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "Foldkit の画面の通信の client は、行ごとの許可を付ければ effect/http-api を import できる",
    path: "web/src/shared/spa-http-client.ts",
    source:
      '// oxlint-disable-next-line no-restricted-imports -- 理由\nimport { HttpApiClient } from "effect/http-api"; export { HttpApiClient };',
    expectedRules: [],
  },
  {
    name: "Foldkit の画面の通信の client も、web の import の禁止を失わない",
    path: "web/src/shared/spa-http-client.ts",
    source: 'import { useState } from "react"; export { useState };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "ほかの web の file は effect/http-api を import できない",
    path: "web/src/mfa/http-api-client.ts",
    source: 'import { HttpApiClient } from "effect/http-api"; export { HttpApiClient };',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "web は effect/crypto と effect/persistence を import できる",
    path: "web/src/shared/secure-random.ts",
    source:
      'import { SecureRandom } from "effect/crypto"; import { KeyValueStore } from "effect/persistence"; export { KeyValueStore, SecureRandom };',
    expectedRules: [],
  },
  {
    name: "Foldkit の file は module の階層に let を置けない (Foldkit の recommended)",
    path: "web/src/mfa/module-let.ts",
    source: 'import { Command } from "foldkit"; export let counter = 0; export { Command };',
    expectedRules: [MODULE_LEVEL_MUTABLE_STATE],
  },
  {
    name: "web の if は braces を省けない",
    path: "web/src/shared/if-without-braces.ts",
    source: "export const sign = (value: number) => { if (value > 0) return 1; return -1; };",
    expectedRules: [BRACES_REQUIRED],
  },
  {
    name: "web の test 以外は型の cast を書けない",
    path: "web/src/shared/cast.ts",
    source: "export const asText = (value: unknown) => value as string;",
    expectedRules: [TYPE_ASSERTION],
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

const TYPE_AWARE_CASES: readonly Case[] = [
  {
    name: "型を使う lint: Promise でない値を await できない (await-thenable)",
    path: "src/type-aware/await-thenable.ts",
    source: "export const waitFor = async (value: number) => {\n  await value;\n};",
    expectedRules: ["typescript(await-thenable)"],
  },
  {
    name: "型を使う lint: 配列の要素を delete できない (no-array-delete)",
    path: "src/type-aware/no-array-delete.ts",
    source: "export const dropFirst = (values: number[]) => {\n  delete values[0];\n};",
    expectedRules: ["typescript(no-array-delete)"],
  },
  {
    name: "型を使う lint: toString を持たない object を文字列にできない (no-base-to-string)",
    path: "src/type-aware/no-base-to-string.ts",
    source: "export const describe = (value: { count: number }) => String(value);",
    expectedRules: ["typescript(no-base-to-string)"],
  },
  {
    name: "型を使う lint: union に同じ型を重ねられない (no-duplicate-type-constituents)",
    path: "src/type-aware/no-duplicate-type-constituents.ts",
    source: "export type Name = string | string;",
    expectedRules: ["typescript(no-duplicate-type-constituents)"],
  },
  {
    name: "型を使う lint: Promise を待たずに捨てられない (no-floating-promises)",
    path: "src/type-aware/no-floating-promises.ts",
    source: "export const start = () => {\n  Promise.resolve(1);\n};",
    expectedRules: ["typescript(no-floating-promises)"],
  },
  {
    name: "型を使う lint: 配列を for-in で回せない (no-for-in-array)",
    path: "src/type-aware/no-for-in-array.ts",
    source:
      "export const count = (values: number[]) => {\n  let total = 0;\n  for (const index in values) {\n    total += index.length;\n  }\n  return total;\n};",
    expectedRules: ["typescript(no-for-in-array)"],
  },
  {
    name: "型を使う lint: 文字列を timer に渡して評価させられない (no-implied-eval)",
    path: "src/type-aware/no-implied-eval.ts",
    source: 'export const schedule = () => setTimeout("globalThis.x = 1", 0);',
    expectedRules: ["typescript(no-implied-eval)"],
  },
  {
    name: "型を使う lint: void を返す式に void を付けられない (no-meaningless-void-operator)",
    path: "src/type-aware/no-meaningless-void-operator.ts",
    source: "const run = (): void => {};\nexport const runAgain = () => void run();",
    expectedRules: ["typescript(no-meaningless-void-operator)"],
  },
  {
    name: "型を使う lint: 文字列を配列に spread できない (no-misused-spread)",
    path: "src/type-aware/no-misused-spread.ts",
    source: "export const letters = (text: string) => [...text];",
    expectedRules: ["typescript(no-misused-spread)"],
  },
  {
    name: "型を使う lint: union を unknown で潰せない (no-redundant-type-constituents)",
    path: "src/type-aware/no-redundant-type-constituents.ts",
    source: "export type Value = unknown | string;",
    expectedRules: ["typescript(no-redundant-type-constituents)"],
  },
  {
    name: "型を使う lint: 数でない値に単項の - を付けられない (no-unsafe-unary-minus)",
    path: "src/type-aware/no-unsafe-unary-minus.ts",
    source: "export const negate = (text: string) => -text;",
    expectedRules: ["typescript(no-unsafe-unary-minus)"],
  },
  {
    name: "型を使う lint: 比べる関数無しで数の配列を sort できない (require-array-sort-compare)",
    path: "src/type-aware/require-array-sort-compare.ts",
    source: "export const ordered = (values: number[]) => values.sort();",
    expectedRules: ["typescript(require-array-sort-compare)"],
  },
  {
    name: "型を使う lint: object を template に埋め込めない (restrict-template-expressions)",
    path: "src/type-aware/restrict-template-expressions.ts",
    source: `export const label = (value: { count: number }) => \`\${value}\`;`,
    expectedRules: ["typescript(no-base-to-string)", "typescript(restrict-template-expressions)"],
  },
  {
    name: "型を使う lint: Promise を条件に使えない (no-misused-promises)",
    path: "src/type-aware/no-misused-promises.ts",
    source: "export const ready = (pending: Promise<void>) => (pending ? 1 : 0);",
    expectedRules: ["typescript(no-misused-promises)"],
  },
  {
    name: "型を使う lint: try の中の Promise を待たずに返せない (return-await)",
    path: "src/type-aware/return-await.ts",
    source:
      "export const load = async () => {\n  try {\n    return Promise.resolve(1);\n  } catch {\n    return 0;\n  }\n};",
    expectedRules: ["typescript(return-await)"],
  },
  {
    name: "型を使う lint: enum を文字列の literal と比べられない (no-unsafe-enum-comparison)",
    path: "src/type-aware/no-unsafe-enum-comparison.ts",
    source: 'enum Kind {\n  A = "a",\n}\nexport const isA = (kind: Kind) => kind === "a";',
    expectedRules: ["typescript(no-unsafe-enum-comparison)"],
  },
  {
    name: "型を使う lint: enum に数と文字列を混ぜられない (no-mixed-enums)",
    path: "src/type-aware/no-mixed-enums.ts",
    source: 'export enum Mixed {\n  A = 0,\n  B = "b",\n}',
    expectedRules: ["typescript(no-mixed-enums)"],
  },
  {
    name: "型を使う lint: 文字列と object を + でつなげない (restrict-plus-operands)",
    path: "src/type-aware/restrict-plus-operands.ts",
    source: "export const join = (text: string, value: { count: number }) => text + value;",
    expectedRules: ["typescript(no-base-to-string)", "typescript(restrict-plus-operands)"],
  },
  {
    name: "型を使う lint: test の file では await-thenable を止めない (bun の matcher の型が void のため)",
    path: "src/__tests__/await-matcher.test.ts",
    source: "export const waitFor = async (value: number) => {\n  await value;\n};",
    expectedRules: [],
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
  const config: { jsPlugins?: { name: string; specifier: string }[] } = JSON.parse(
    readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8"),
  );
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

const TYPE_AWARE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "ES2023",
    module: "esnext",
    moduleResolution: "bundler",
    skipLibCheck: true,
    types: [],
  },
  include: ["**/*.ts"],
});

type LintMode = "Syntax" | "TypeAware";

const OXLINT_ARGS: Record<LintMode, readonly string[]> = {
  Syntax: ["--format", "json", "."],
  TypeAware: ["--type-aware", "--format", "json", "."],
};

const lintGroup = (group: readonly Case[], mode: LintMode = "Syntax"): void => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "oxlint-rules-"));
  fixtureDirs.push(fixtureDir);
  writeFileSync(join(fixtureDir, ".oxlintrc.json"), configWithJsPluginsFromRepo());
  mkdirSync(join(fixtureDir, "packages/auth-client/src"), { recursive: true });
  writeFileSync(join(fixtureDir, "packages/auth-client/src/types.ts"), "export type Types = 1;\n");
  for (const { path, source } of group) {
    mkdirSync(dirname(join(fixtureDir, path)), { recursive: true });
    writeFileSync(join(fixtureDir, path), `${source}\n`);
  }
  if (mode === "TypeAware") {
    writeFileSync(join(fixtureDir, "tsconfig.json"), TYPE_AWARE_TSCONFIG);
  }
  const result = spawnSync(OXLINT, [...OXLINT_ARGS[mode]], {
    cwd: fixtureDir,
    encoding: "utf8",
    env: {
      ...process.env,
      OXLINT_TSGOLINT_PATH: join(REPO_ROOT, "node_modules/oxlint-tsgolint/bin/tsgolint.js"),
    },
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
  for (const group of groupsWithDistinctPaths(CASES)) lintGroup(group);
  lintGroup(TYPE_AWARE_CASES, "TypeAware");
});

afterAll(() => {
  for (const fixtureDir of fixtureDirs) rmSync(fixtureDir, { recursive: true, force: true });
});

describe("lint の rule は、oxlint で決めた path に効く", () => {
  test.each([...CASES, ...TYPE_AWARE_CASES])("$name", (testCase: Case) => {
    expect(rulesByCase.get(testCase)).toEqual([...testCase.expectedRules]);
  });

  test("fixture の file はすべて oxlint に読まれるので、指摘の無い case は読み飛ばしで通らない", () => {
    expect(lintedFileCounts.map(({ linted }) => linted)).toEqual(
      lintedFileCounts.map(({ written }) => written),
    );
  });
});
