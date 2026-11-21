import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { repoFiles } from "./source-scan";

const REPO_ROOT = join(import.meta.dir, "../..");
const OXLINT = join(REPO_ROOT, "node_modules/.bin/oxlint");

type Case = {
  readonly name: string;
  readonly path: string;
  readonly source: string;
  readonly expectedRules: readonly string[];
};

const RESTRICTED_IMPORT = "eslint(no-restricted-imports)";
const DB_IMPORT = "taimei(db-import-only-in-db)";
const SCRIPTS_IMPORT = "taimei(scripts-import-only-node-builtins)";
const DB_VALUE_IMPORT_IN_TEST = "taimei(db-value-import-only-in-db-in-tests)";
const SDK_IMPORT = "taimei(sdk-import-only-peer-dependencies)";
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
const DIALOG_VISIBLE = "taimei(dialog-visible-only-by-is-dialog-visible)";
const DIALOG_TRANSITION_STATE = "taimei(dialog-transition-state-only-in-dialog-view)";
const DIALOG_HELD_REPORT = "taimei(dialog-held-report-only-in-dialog-view)";
const PAGE_REQUEST = "taimei(page-request-only-in-page-request)";
const EXTERNAL_FONT = "taimei(no-external-font-host)";
const FORM_VIEW = "taimei(form-only-in-form-view)";
const CHILD_MESSAGE_IN_ROOT = "foldkit(no-child-message-construction-in-root)";
const DIRECT_APPLICATION_START = "taimei(no-direct-application-start)";
const MODULE_LEVEL_MUTABLE_STATE = "foldkit(no-module-level-mutable-state)";
const BRACES_REQUIRED = "eslint(curly)";
const TYPE_ASSERTION = "typescript(consistent-type-assertions)";

const CASES: readonly Case[] = [
  {
    name: "Flagship の binding の評価を src/feature-flags.ts の外から呼べない",
    path: "src/passkey/FlagshipProbe.ts",
    source:
      'export const on = (flags: { getBooleanDetails: (key: string, fallback: boolean) => Promise<unknown> }) => flags.getBooleanDetails("example", false);',
    expectedRules: ["taimei(flagship-binding-only-in-feature-flags)"],
  },
  {
    name: "フィーチャーフラグの port を機能ごとの判定の file の外で使えない",
    path: "src/passkey/FeatureFlagsProbe.ts",
    source: 'import { FeatureFlags } from "../feature-flags";\nexport const port = FeatureFlags;',
    expectedRules: ["taimei(feature-flags-port-only-in-flag-decisions)"],
  },
  {
    name: "機能の code は、enabled に flag の名前を渡して評価できる",
    path: "src/company/availability.ts",
    source:
      'import { enabled } from "../feature-flags";\nexport const open = () => enabled("example");',
    expectedRules: [],
  },
  {
    name: "e2e の spec はフィーチャーフラグの試験 API を直接呼べない",
    path: "e2e/FlagSwitchProbe.e2e.ts",
    source: "export const path = `/testing/v1/feature-flags`;",
    expectedRules: ["taimei(feature-flag-switch-only-in-helpers)"],
  },
  {
    name: "handler は機能のフィーチャーフラグの判定を import できない",
    path: "src/handlers/OtherFlagDecisionProbe.ts",
    source: 'import { open } from "../company/availability";\nexport const decided = open;',
    expectedRules: ["taimei(no-flag-decision-in-handlers-rpc-web)"],
  },
  {
    name: "page は dialog を描くかどうかを dialog.isOpen で決められない",
    path: "web/src/account/pages/DialogVisibleProbe.ts",
    source:
      "export const shows = (model: { enrollment: { dialog: { isOpen: boolean } } }) => model.enrollment.dialog.isOpen;",
    expectedRules: [DIALOG_VISIBLE],
  },
  {
    name: "house の dialog の外は、dialog の animation の状態を直接比べられない",
    path: "web/src/company/dialog-transition-probe.ts",
    source:
      'export const isLeaving = (model: { dialog: { animation: { transitionState: string } } }) => model.dialog.animation.transitionState === "LeaveStart";',
    expectedRules: [DIALOG_TRANSITION_STATE],
  },
  {
    name: "house の dialog の外は、閉じた後に出す報告を直接読めない",
    path: "web/src/company/dialog-held-report-probe.ts",
    source:
      "export const held = (model: { dialog: { maybeOutMessageAfterClose: unknown } }) => model.dialog.maybeOutMessageAfterClose;",
    expectedRules: [DIALOG_HELD_REPORT],
  },
  {
    name: "画面は h.form で form を書けない。novalidate と送信の時の誤りの表示が抜ける",
    path: "web/src/company/form-probe.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const view = <M>(h: HtmlBuilder<M>) => h.form([], ["x"]);',
    expectedRules: [FORM_VIEW],
  },
  {
    name: "form の部品の file は h.form を書ける",
    path: "web/src/shared/ui/form-view.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const view = <M>(h: HtmlBuilder<M>) => h.form([], ["x"]);',
    expectedRules: [],
  },
  {
    name: "メールの template は Google Fonts を @import できない",
    path: "src/email/font-probe.ts",
    source:
      "export const style = `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP');`;",
    expectedRules: [EXTERNAL_FONT],
  },
  {
    name: "画面の code は Google Fonts の font を読めない",
    path: "web/src/shared/font-probe.ts",
    source: 'export const href = "https://fonts.googleapis.com/css2?family=Inter";',
    expectedRules: [EXTERNAL_FONT],
  },
  {
    name: "本番以外の shell は Google Fonts の stylesheet を読めない",
    path: "testing/font-probe.ts",
    source:
      'export const link = "<link rel=\\"preconnect\\" href=\\"https://fonts.gstatic.com\\" />";',
    expectedRules: [EXTERNAL_FONT],
  },
  {
    name: "要求の番号を来訪番号と組にせず Schema に書けない。page を作り直した後に前の page の応答を受ける",
    path: "web/src/company/request-number-probe.ts",
    source:
      'import { Schema } from "effect";\nexport const Fields = { requestNumber: Schema.Int };',
    expectedRules: [PAGE_REQUEST],
  },
  {
    name: "要求の番号を直接読んで応答を照合できない",
    path: "web/src/company/request-number-read-probe.ts",
    source:
      "export const isCurrent = (model: { requestNumber: number }, requestNumber: number) => model.requestNumber === requestNumber;",
    expectedRules: [PAGE_REQUEST],
  },
  {
    name: "応答の要求の番号を分割代入で取り出して照合できない",
    path: "web/src/company/request-number-destructure-probe.ts",
    source:
      "export const isCurrent = (current: number, { requestNumber }: { requestNumber: number }) => requestNumber === current;",
    expectedRules: [PAGE_REQUEST],
  },
  {
    name: "要求の番号の初期値と進め方を手で書けない。進めずに次の要求を送ると、前の要求の応答を受ける",
    path: "web/src/company/request-number-init-probe.ts",
    source: "export const init = (visit: number) => ({ visit, requestNumber: 0 });",
    expectedRules: [PAGE_REQUEST],
  },
  {
    name: "要求の番号を文字列の key で読めない",
    path: "web/src/company/request-number-computed-probe.ts",
    source: 'export const read = (model: { requestNumber: number }) => model["requestNumber"];',
    expectedRules: [PAGE_REQUEST],
  },
  {
    name: "要求の field の組と照合は shared/page-request.ts に置ける",
    path: "web/src/shared/page-request.ts",
    source:
      'import { Schema } from "effect";\nexport const Fields = { visit: Schema.Int, requestNumber: Schema.Int };\nexport const same = (a: { requestNumber: number }, b: { requestNumber: number }) => a.requestNumber === b.requestNumber;',
    expectedRules: [],
  },
  {
    name: "dialog を持つ Submodel は、開いている間の再操作を dialog.isOpen で止められる",
    path: "web/src/company/dialog-open-probe.ts",
    source:
      "export const isOpen = (model: { dialog: { isOpen: boolean } }) => model.dialog.isOpen;",
    expectedRules: [],
  },
  {
    name: "dialog の開閉の resolver の file は、試験のために子の Message を組める",
    path: "web/src/shared/__tests__/dialog-resolvers.ts",
    source:
      'import { Animation } from "@foldkit/ui";\nexport const settled = Animation.Message.EndedAnimation({ generation: 1 });',
    expectedRules: [],
  },
  {
    name: "ほかの試験用の file は、production と同じく子の Message を組めない",
    path: "web/src/shared/__tests__/other-support.ts",
    source:
      'import { Animation } from "@foldkit/ui";\nexport const settled = Animation.Message.EndedAnimation({ generation: 1 });',
    expectedRules: [CHILD_MESSAGE_IN_ROOT],
  },
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
    name: "scripts は依存を install する前に走るので、package を import できない",
    path: "scripts/package-import.ts",
    source: 'import "effect";',
    expectedRules: [SCRIPTS_IMPORT],
  },
  {
    name: "scripts は依存を install する前に走るので、package を import() で読めない",
    path: "scripts/package-dynamic-import.ts",
    source: 'export const loaded = await import("effect");',
    expectedRules: [SCRIPTS_IMPORT],
  },
  {
    name: "scripts は createRequire で package を読めない",
    path: "scripts/package-create-require.ts",
    source:
      'import { createRequire } from "node:module";\nexport const loaded = createRequire(import.meta.url)("effect");',
    expectedRules: [SCRIPTS_IMPORT],
  },
  {
    name: "scripts は import.meta.require で package を読めない",
    path: "scripts/package-meta-require.ts",
    source: 'export const loaded = import.meta.require("effect");',
    expectedRules: [SCRIPTS_IMPORT],
  },
  {
    name: "scripts は node: の組み込みの module を import できる",
    path: "scripts/node-import.ts",
    source: 'import { join } from "node:path";\nexport const joined = join("a", "b");',
    expectedRules: [],
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
    expectedRules: [DB_IMPORT],
  },
  {
    name: "src は @/db/client を直接 import できない",
    path: "src/db-client.ts",
    source: 'import "@/db/client";',
    expectedRules: [DB_IMPORT],
  },
  {
    name: "src は @/db/schema を直接 import できない",
    path: "src/db-schema.ts",
    source: 'import "@/db/schema";',
    expectedRules: [DB_IMPORT],
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
    name: "src/auth.ts は db/client と db/schema を import できる",
    path: "src/auth.ts",
    source: 'import "@/db/client";\nimport "@/db/schema";',
    expectedRules: [],
  },
  {
    name: "src/auth.ts も drizzle-orm は import できない",
    path: "src/auth.ts",
    source: 'import "drizzle-orm";',
    expectedRules: [DB_IMPORT],
  },
  {
    name: "src は db/client を相対 path でも import できない",
    path: "src/handlers/relative-db-client.ts",
    source: 'import "../../db/client";',
    expectedRules: [DB_IMPORT],
  },
  {
    name: "src は drizzle-orm を型でも import できない",
    path: "src/drizzle-type.ts",
    source: 'import type { SQL } from "drizzle-orm";\nexport type S = SQL;',
    expectedRules: [DB_IMPORT],
  },
  {
    name: "src の test は drizzle-orm を値で import できない",
    path: "src/__tests__/drizzle.test.ts",
    source: 'import "drizzle-orm";',
    expectedRules: [DB_VALUE_IMPORT_IN_TEST],
  },
  {
    name: "testing の test は drizzle-orm を値で import できない",
    path: "testing/__tests__/drizzle.test.ts",
    source: 'import "drizzle-orm";',
    expectedRules: [DB_VALUE_IMPORT_IN_TEST],
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
    expectedRules: [DB_IMPORT],
  },
  {
    name: "e2e の spec は pg を import できない",
    path: "e2e/pg.spec.ts",
    source: 'import "pg";',
    expectedRules: [DB_IMPORT],
  },
  {
    name: "e2e の spec は db を相対 path で import できない",
    path: "e2e/db.spec.ts",
    source: 'import "../db/schema";',
    expectedRules: [DB_IMPORT, "taimei(db-import-in-e2e-only-db-testing)"],
  },
  {
    name: "e2e の spec は db/repositories を値で import できない",
    path: "e2e/repository.spec.ts",
    source: 'import { findUser } from "@/db/repositories/user";\nexport { findUser };',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)"],
  },
  {
    name: "退会の成功の message を、持ち主の page の外で直接比べられない",
    path: "web/src/app/account/zz-deleted.ts",
    source:
      'import * as Companies from "../../company/pages/Companies";\nexport const deleted = Companies.Message.SucceededLeaveLastCompany;',
    expectedRules: ["taimei(account-deleted-message-only-in-owning-page)"],
  },
  {
    name: "事業所を変えた成功の message を、持ち主の module の外で直接比べられない",
    path: "web/src/app/account/zz-company-change.ts",
    source:
      'import * as AddCompany from "../../company/add-company";\nexport const added = AddCompany.Message.SucceededAddCompany;',
    expectedRules: ["taimei(company-change-message-only-in-owning-module)"],
  },
  {
    name: "失敗の class を作る failure() と同じ名前の method (Exit.failure など) は呼べる",
    path: "src/exit-failure.ts",
    source:
      "declare const Exit: { failure(value: number): unknown };\nexport const failed = Exit.failure(1);",
    expectedRules: [],
  },
  {
    name: "e2e の spec は effect を import できない",
    path: "e2e/effect.spec.ts",
    source: 'import "effect";',
    expectedRules: [RESTRICTED_IMPORT],
  },
  {
    name: "e2e/fixtures.ts も pg は import できない",
    path: "e2e/fixtures.ts",
    source: 'import "pg";',
    expectedRules: [DB_IMPORT],
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
    source: 'import type { HttpClient } from "effect/http"; export type C = HttpClient.HttpClient;',
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
    expectedRules: [DB_IMPORT],
  },
  {
    name: "web は pg を import できない",
    path: "web/non-production/pg.ts",
    source: 'import "pg";',
    expectedRules: [DB_IMPORT],
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
    expectedRules: [SDK_IMPORT],
  },
  {
    name: "SDK は next/headers を import できない",
    path: "packages/auth-client/src/next.ts",
    source: 'import "next/headers";',
    expectedRules: [SDK_IMPORT],
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
  {
    name: "e2e の fixture は @/db/testing の外の @/db を値で import できない",
    path: "e2e/fixtures.ts",
    source: 'import { db } from "@/db/client";\nexport { db };',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)", DB_IMPORT],
  },
  {
    name: "e2e の fixture は @/db/testing を import できる",
    path: "e2e/fixtures.ts",
    source: 'import { createSeed } from "@/db/testing/seed";\nexport { createSeed };',
    expectedRules: [],
  },
  {
    name: "shebang はコメントとして止めない",
    path: "management/shebang-probe.ts",
    source: "#!/usr/bin/env bun\nexport const a = 1;",
    expectedRules: [],
  },
  {
    name: "each を使わない test file の入れ子の配列は、test 名の行として読まない",
    path: "src/__tests__/rows-probe.test.ts",
    source: 'export const rows = [["AC-001 x", 1]];',
    expectedRules: [],
  },
  {
    name: "each に渡す行の名前に設計書の番号を書けない",
    path: "src/__tests__/each-probe.test.ts",
    source: 'const rows = [["AC-001 x", 1]];\ntest.each(rows)("%s", () => {});',
    expectedRules: ["taimei(no-design-number-in-test-name)"],
  },
  {
    name: "SPA の API の file でも、決めた service の外の Layer.effect は書けない",
    path: "src/handlers/spa-http-api.ts",
    source: "export const l = Layer.effect(Other, make);",
    expectedRules: ["taimei(no-failing-layer-constructor-in-src)"],
  },
  {
    name: "SPA の API の file は、認証の service の Layer.effect を書ける",
    path: "src/handlers/spa-http-api.ts",
    source: "export const l = Layer.effect(Authenticated, make);",
    expectedRules: [],
  },
  {
    name: "better-auth の失敗の code を key の名前でも読めない",
    path: "src/membership/unauthorized-probe.ts",
    source: "export const codes = { UNAUTHORIZED: 1 };",
    expectedRules: ["taimei(api-error-shape-only-in-auth-wiring)"],
  },
  {
    name: "src/mfa の file で AuthApi.issueSession を呼べない",
    path: "src/mfa/IssueSessionProbe.ts",
    source: "export const r = (api: { issueSession(): void }) => api.issueSession();",
    expectedRules: ["taimei(issue-session-only-in-establish-sign-in)"],
  },
  {
    name: "src/mfa/totp の file で AuthApi.issueSession を呼べない",
    path: "src/mfa/totp/IssueSessionProbe.ts",
    source: "export const r = (api: { issueSession(): void }) => api.issueSession();",
    expectedRules: ["taimei(issue-session-only-in-establish-sign-in)"],
  },
  {
    name: "src/handlers の file で AuthApi.issueSession を呼べない",
    path: "src/handlers/IssueSessionProbe.ts",
    source: "export const r = (api: { issueSession(): void }) => api.issueSession();",
    expectedRules: ["taimei(issue-session-only-in-establish-sign-in)"],
  },
  {
    name: "src/passkey の file で AuthApi.issueSession を呼べない",
    path: "src/passkey/IssueSessionProbe.ts",
    source: "export const r = (api: { issueSession(): void }) => api.issueSession();",
    expectedRules: ["taimei(issue-session-only-in-establish-sign-in)"],
  },
  {
    name: "src 直下 の file で AuthApi.issueSession を呼べない",
    path: "src/IssueSessionProbe.ts",
    source: "export const r = (api: { issueSession(): void }) => api.issueSession();",
    expectedRules: ["taimei(issue-session-only-in-establish-sign-in)"],
  },
  {
    name: "MFA チャレンジの通過の file で AuthApi.issueSession を呼べない",
    path: "src/mfa/totp/complete-login-challenge.ts",
    source: "export const r = (api: { issueSession(): void }) => api.issueSession();",
    expectedRules: ["taimei(issue-session-only-in-establish-sign-in)"],
  },
  {
    name: "ログインの成立の手順の file は AuthApi.issueSession を呼べる",
    path: "src/establish-sign-in.ts",
    source: "export const r = (api: { issueSession(): void }) => api.issueSession();",
    expectedRules: [],
  },
  {
    name: "src/passkey の file は @simplewebauthn/server の値の import を書けない",
    path: "src/passkey/SimpleWebauthnValueProbe.ts",
    source:
      'import { verifyRegistrationResponse } from "@simplewebauthn/server";\nexport const probe = verifyRegistrationResponse;',
    expectedRules: ["taimei(simplewebauthn-import-only-in-webauthn)"],
  },
  {
    name: "src/passkey の file は @simplewebauthn/server の型の import を書けない",
    path: "src/passkey/SimpleWebauthnTypeProbe.ts",
    source:
      'import type { RegistrationResponseJSON } from "@simplewebauthn/server";\nexport type Probe = RegistrationResponseJSON;',
    expectedRules: ["taimei(simplewebauthn-import-only-in-webauthn)"],
  },
  {
    name: "src/passkey の file は @simplewebauthn/server の subpath の値の import を書けない",
    path: "src/passkey/SimpleWebauthnSubpathProbe.ts",
    source:
      'import { isoBase64URL } from "@simplewebauthn/server/helpers";\nexport const probe = isoBase64URL;',
    expectedRules: ["taimei(simplewebauthn-import-only-in-webauthn)"],
  },
  {
    name: "src/handlers の file は @simplewebauthn/server の値の import を書けない",
    path: "src/handlers/SimpleWebauthnValueProbe.ts",
    source:
      'import { verifyRegistrationResponse } from "@simplewebauthn/server";\nexport const probe = verifyRegistrationResponse;',
    expectedRules: ["taimei(simplewebauthn-import-only-in-webauthn)"],
  },
  {
    name: "src/handlers の file は @simplewebauthn/server の型の import を書けない",
    path: "src/handlers/SimpleWebauthnTypeProbe.ts",
    source:
      'import type { RegistrationResponseJSON } from "@simplewebauthn/server";\nexport type Probe = RegistrationResponseJSON;',
    expectedRules: ["taimei(simplewebauthn-import-only-in-webauthn)"],
  },
  {
    name: "web/src の file は @simplewebauthn/server の値の import を書けない",
    path: "web/src/SimpleWebauthnValueProbe.ts",
    source:
      'import { verifyRegistrationResponse } from "@simplewebauthn/server";\nexport const probe = verifyRegistrationResponse;',
    expectedRules: [
      "taimei(no-webauthn-package-in-web)",
      "taimei(simplewebauthn-import-only-in-webauthn)",
    ],
  },
  {
    name: "src/passkey/__tests__ の file は @simplewebauthn/server の値の import を書けない",
    path: "src/passkey/__tests__/SimpleWebauthnValueProbe.test.ts",
    source:
      'import { verifyRegistrationResponse } from "@simplewebauthn/server";\nexport const probe = verifyRegistrationResponse;',
    expectedRules: ["taimei(simplewebauthn-import-only-in-webauthn)"],
  },
  {
    name: "src/passkey/__tests__ の file は @simplewebauthn/server の型の import を書けない",
    path: "src/passkey/__tests__/SimpleWebauthnTypeProbe.test.ts",
    source:
      'import type { RegistrationResponseJSON } from "@simplewebauthn/server";\nexport type Probe = RegistrationResponseJSON;',
    expectedRules: ["taimei(simplewebauthn-import-only-in-webauthn)"],
  },
  {
    name: "検証の入口 src/passkey/webauthn.ts は @simplewebauthn/server を import できる",
    path: "src/passkey/webauthn.ts",
    source:
      'import { verifyRegistrationResponse } from "@simplewebauthn/server";\nexport const probe = verifyRegistrationResponse;',
    expectedRules: [],
  },
  {
    name: "web/src の別の file で PublicKeyCredential.parseCreationOptionsFromJSON を呼べない",
    path: "web/src/account/ParseCreationOptionsProbe.ts",
    source:
      'import { Effect } from "effect";\nexport const probe = (json: PublicKeyCredentialCreationOptionsJSON) => Effect.sync(() => PublicKeyCredential.parseCreationOptionsFromJSON(json));',
    expectedRules: ["taimei(webauthn-call-only-in-passkey-webauthn)"],
  },
  {
    name: "web/src の別の file は、PublicKeyCredential.parseCreationOptionsFromJSON の呼び出しを除いた同じ形なら書ける",
    path: "web/src/account/ParseCreationOptionsWithoutCallProbe.ts",
    source:
      'import { Effect } from "effect";\nexport const probe = (json: unknown) => Effect.sync(() => json);',
    expectedRules: [],
  },
  {
    name: "web/src の別の file で navigator.credentials.create を呼べない",
    path: "web/src/account/CreateCredentialProbe.ts",
    source:
      'import { Effect } from "effect";\nexport const probe = (publicKey: PublicKeyCredentialCreationOptions) => Effect.tryPromise(() => navigator.credentials.create({ publicKey }));',
    expectedRules: ["taimei(webauthn-call-only-in-passkey-webauthn)"],
  },
  {
    name: "web/src の別の file は、navigator.credentials.create の呼び出しを除いた同じ形なら書ける",
    path: "web/src/account/CreateCredentialWithoutCallProbe.ts",
    source:
      'import { Effect } from "effect";\nexport const probe = (publicKey: unknown) => Effect.tryPromise(() => Promise.resolve(publicKey));',
    expectedRules: [],
  },
  {
    name: "fetch を書かない: web/src/company に書くと lint が止める",
    path: "web/src/company/Probe001.ts",
    source: 'export const load = () => fetch("/x");',
    expectedRules: ["taimei(no-fetch-in-web)"],
  },
  {
    name: "SpaHttpClient は Foldkit の file と application の entry だけ: web/src/shared に書くと lint が止める",
    path: "web/src/shared/Probe002.ts",
    source: 'import { SpaHttpClient } from "./spa-http-client"; export const c = SpaHttpClient;',
    expectedRules: ["taimei(spa-http-client-only-in-foldkit-files)"],
  },
  {
    name: "SpaHttpClient は Foldkit の file と application の entry だけ: web/src/shared では lint が止めない",
    path: "web/src/shared/Probe003.ts",
    source:
      'import { SpaHttpClient } from "./spa-http-client"; import { Command } from "foldkit"; export const c = [SpaHttpClient, Command];',
    expectedRules: [],
  },
  {
    name: "SpaHttpClient は Foldkit の file と application の entry だけ: web/src/app/probe では lint が止めない",
    path: "web/src/app/probe/entry.ts",
    source:
      'import { SpaHttpClient } from "../../shared/spa-http-client"; export const c = SpaHttpClient;',
    expectedRules: [],
  },
  {
    name: "SpaHttpClient は Foldkit の file と application の entry だけ: web/src/company では lint が止めない",
    path: "web/src/company/Probe004.ts",
    source:
      'import type { SpaHttpClient } from "../shared/spa-http-client"; export type C = SpaHttpClient;',
    expectedRules: [],
  },
  {
    name: "effect/http の値の import は書かない: web/src/shared に書くと lint が止める",
    path: "web/src/shared/Probe005.ts",
    source: 'import { HttpClient } from "effect/http"; export const c = HttpClient;',
    expectedRules: ["taimei(no-effect-http-value-import-in-web)"],
  },
  {
    name: "effect/http の値の import は書かない: web/src/shared では lint が止めない",
    path: "web/src/shared/Probe006.ts",
    source:
      'import type { HttpClientError } from "effect/http"; export type E = HttpClientError.HttpClientError;',
    expectedRules: [],
  },
  {
    name: "better-auth の一覧の読み出しは auth-client-read.ts だけ: web/src/account に書くと lint が止める",
    path: "web/src/account/Probe007.ts",
    source: "export const f = (client: { listSessions(): void }) => client.listSessions();",
    expectedRules: ["taimei(auth-client-list-only-in-auth-client-read)"],
  },
  {
    name: "better-auth の一覧の読み出しは auth-client-read.ts だけ: web/src/account では lint が止めない",
    path: "web/src/account/auth-client-read.ts",
    source: "export const f = (client: { listSessions(): void }) => client.listSessions();",
    expectedRules: [],
  },
  {
    name: "SPA を離れる遷移 (location.replace / assign、Navigation.load): web/src/shared に書くと lint が止める",
    path: "web/src/shared/Probe008.ts",
    source: "export const go = (url: string) => window.location.replace(url);",
    expectedRules: ["taimei(leave-spa-only-in-leave-spa)"],
  },
  {
    name: "SPA を離れる遷移 (location.replace / assign、Navigation.load): web/src/shared では lint が止めない",
    path: "web/src/shared/leave-spa.ts",
    source: "export const go = (url: string) => window.location.replace(url);",
    expectedRules: [],
  },
  {
    name: "SPA を離れる遷移 (location.replace / assign、Navigation.load): web/src/shared では lint が止めない",
    path: "web/src/shared/Probe009.ts",
    source: "export const here = window.location.href;",
    expectedRules: [],
  },
  {
    name: "SPA を離れる遷移 (location.replace / assign、Navigation.load) (location.href への代入): web/src/shared に書くと lint が止める",
    path: "web/src/shared/Probe010.ts",
    source: "export const go = (url: string) => { window.location.href = url; };",
    expectedRules: ["taimei(leave-spa-only-in-leave-spa)"],
  },
  {
    name: "SPA を離れる遷移 (location.replace / assign、Navigation.load) (location.href への代入): web/src/shared では lint が止めない",
    path: "web/src/shared/Probe011.ts",
    source: "export const same = (a: string) => window.location.href === a;",
    expectedRules: [],
  },
  {
    name: "SPA を離れる遷移 (location.replace / assign、Navigation.load) (foldkit/navigation の load の import): web/src/shared に書くと lint が止める",
    path: "web/src/shared/Probe012.ts",
    source: 'import { load } from "foldkit/navigation"; export const go = load;',
    expectedRules: ["taimei(leave-spa-only-in-leave-spa)"],
  },
  {
    name: "cause を捨てる onFailure: web/src/company に書くと lint が止める",
    path: "web/src/company/Probe013.ts",
    source: "export const handlers = { onSuccess: () => 1, onFailure: () => 0 };",
    expectedRules: ["taimei(no-ignored-cause-in-web)"],
  },
  {
    name: "cause を捨てる onFailure: web/src/company では lint が止めない",
    path: "web/src/company/Probe014.ts",
    source: "export const handlers = { onFailure: (cause: unknown) => String(cause) };",
    expectedRules: [],
  },
  {
    name: "orElseSucceed を書かない: web/src/company に書くと lint が止める",
    path: "web/src/company/Probe015.ts",
    source: "export const r = Effect.orElseSucceed;",
    expectedRules: ["taimei(no-or-else-succeed)"],
  },
  {
    name: "sign-out は auth/sign-out.ts だけ: web/src/account に書くと lint が止める",
    path: "web/src/account/Probe016.ts",
    source: "export const f = (client: { signOut(): void }) => client.signOut();",
    expectedRules: ["taimei(sign-out-only-in-sign-out)"],
  },
  {
    name: "sign-out は auth/sign-out.ts だけ: web/src/account では lint が止めない",
    path: "web/src/account/Probe017.ts",
    source: "export const f = (model: { signOut: number }) => model.signOut;",
    expectedRules: [],
  },
  {
    name: "失敗の _tag の判定は failure-message.ts に集める: web/src/company に書くと lint が止める",
    path: "web/src/company/Probe018.ts",
    source: "export const f = (c: Cause.Cause<unknown>) => Cause.findErrorOption(c);",
    expectedRules: ["taimei(cause-lookup-only-in-failure-message)"],
  },
  {
    name: "失敗の _tag の判定は failure-message.ts に集める: web/src/shared では lint が止めない",
    path: "web/src/shared/failure-message.ts",
    source: "export const f = (c: Cause.Cause<unknown>) => Cause.findErrorOption(c);",
    expectedRules: [],
  },
  {
    name: "src で APP_ENV を読むのは sentry-options.ts だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe019.ts",
    source: 'export const secure = process.env.APP_ENV === "production";',
    expectedRules: ["taimei(app-env-only-in-sentry-options)"],
  },
  {
    name: "src で APP_ENV を読むのは sentry-options.ts だけ: src では lint が止めない",
    path: "src/sentry-options.ts",
    source: 'export const secure = process.env.APP_ENV === "production";',
    expectedRules: [],
  },
  {
    name: "web/src は vite の build の mode を読まない: web/src/shared に書くと lint が止める",
    path: "web/src/shared/Probe020.ts",
    source: "export const isProduction = import.meta.env.PROD;",
    expectedRules: ["taimei(no-build-mode-in-web)"],
  },
  {
    name: "web/src は vite の build の mode を読まない: web/src/shared では lint が止めない",
    path: "web/src/shared/Probe021.ts",
    source: "export const token = import.meta.env.VITE_CANARY_TOKEN_ID;",
    expectedRules: [],
  },
  {
    name: "handlers に runInTransaction が出ない: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe022.ts",
    source: "export const r = () => runInTransaction(async () => 1);",
    expectedRules: ["taimei(run-in-transaction-only-in-transaction)"],
  },
  {
    name: "handlers に runInTransaction が出ない: src では lint が止めない",
    path: "src/transaction.ts",
    source: "export const r = () => runInTransaction(async () => 1);",
    expectedRules: [],
  },
  {
    name: "SPA の API (/api/account、/api/mfa) を Hono に直接登録しない: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe023.ts",
    source:
      'export const register = (app: { get(path: string): void }) => app.get("/api/account/memberships");',
    expectedRules: ["taimei(spa-api-path-only-in-contract)"],
  },
  {
    name: "SPA の API (/api/account、/api/mfa) を Hono に直接登録しない: src/account では lint が止めない",
    path: "src/account/Probe024-contract.ts",
    source: 'export const path = "/api/account/memberships";',
    expectedRules: [],
  },
  {
    name: "HttpApi の handler は HttpServerResponse を直接組まない: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe025-http-api.ts",
    source:
      'import { HttpServerResponse } from "effect/http"; export const r = HttpServerResponse.json({});',
    expectedRules: ["taimei(no-raw-http-response-in-handlers)"],
  },
  {
    name: "HttpApi の handler は HttpServerResponse を直接組まない: src/handlers では lint が止めない",
    path: "src/handlers/Probe026-http-api.ts",
    source:
      'import { HttpServerResponse } from "effect/http"; export const r = HttpServerResponse.mergeCookies;',
    expectedRules: [],
  },
  {
    name: "SPA の handler は repository の port を値として import しない: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe027-http-api.ts",
    source: 'import { AccountPorts } from "../account/ports"; export const p = AccountPorts;',
    expectedRules: ["taimei(port-import-only-in-reading-transport)"],
  },
  {
    name: "SPA の handler は repository の port を値として import しない: src/handlers では lint が止めない",
    path: "src/handlers/Probe028-http-api.ts",
    source: 'import type { AccountPorts } from "../account/ports"; export type P = AccountPorts;',
    expectedRules: [],
  },
  {
    name: "db/ は effect を import しない: db/repositories に書くと lint が止める",
    path: "db/repositories/Probe029.ts",
    source: 'import { Effect } from "effect"; export const e = Effect;',
    expectedRules: ["taimei(no-effect-in-db)"],
  },
  {
    name: "db/ は effect を import しない: db/repositories に書くと lint が止める",
    path: "db/repositories/Probe030.ts",
    source: 'import type { Effect } from "effect"; export type E = Effect<void>;',
    expectedRules: ["taimei(no-effect-in-db)"],
  },
  {
    name: "web/src の effect の subpath は http・crypto・persistence だけ: web/src/shared に書くと lint が止める",
    path: "web/src/shared/Probe031.ts",
    source: 'import { Schema } from "effect/Schema"; export const s = Schema;',
    expectedRules: ["eslint(no-restricted-imports)"],
  },
  {
    name: "web/src の effect の subpath は http・crypto・persistence だけ: web/src/shared では lint が止めない",
    path: "web/src/shared/Probe032.ts",
    source:
      'import type { HttpClientError } from "effect/http"; export type E = HttpClientError.HttpClientError;',
    expectedRules: [],
  },
  {
    name: "effect/http-api は SpaHttpClient の file だけ: web/src/company に書くと lint が止める",
    path: "web/src/company/Probe033.ts",
    source: 'import { HttpApiClient } from "effect/http-api"; export const c = HttpApiClient;',
    expectedRules: ["eslint(no-restricted-imports)"],
  },
  {
    name: "effect/http-api は SpaHttpClient の file だけ: web/src/shared では lint が止めない",
    path: "web/src/shared/spa-http-client.ts",
    source:
      '// oxlint-disable-next-line no-restricted-imports -- Foldkit の画面の Command が SPA の API の契約から client を作るのはこの file だけ\nimport { HttpApiClient } from "effect/http-api"; export const c = HttpApiClient;',
    expectedRules: [],
  },
  {
    name: "db/repositories と db/transaction の runtime import は限る: src/membership に書くと lint が止める",
    path: "src/membership/Probe034.ts",
    source: 'import * as repo from "@/db/repositories/membership"; export const r = repo;',
    expectedRules: ["taimei(repository-import-only-in-wiring)"],
  },
  {
    name: "db/repositories と db/transaction の runtime import は限る: src/membership では lint が止めない",
    path: "src/membership/wiring.ts",
    source: 'import * as repo from "@/db/repositories/membership"; export const r = repo;',
    expectedRules: [],
  },
  {
    name: "db/repositories と db/transaction の runtime import は限る: src/membership では lint が止めない",
    path: "src/membership/Probe035.ts",
    source:
      'import type { MembershipRow } from "@/db/repositories/membership"; export type R = MembershipRow;',
    expectedRules: [],
  },
  {
    name: "runInTransaction の直呼びは transaction.ts だけ: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe036.ts",
    source: "export const r = () => runInTransaction(async () => 1);",
    expectedRules: ["taimei(run-in-transaction-only-in-transaction)"],
  },
  {
    name: "runInTransaction の直呼びは transaction.ts だけ: src では lint が止めない",
    path: "src/transaction.ts",
    source: "export const r = () => runInTransaction(async () => 1);",
    expectedRules: [],
  },
  {
    name: "Promise.all の直呼びが 0: src/membership に書くと lint が止める",
    path: "src/membership/Probe037.ts",
    source: "export const r = () => Promise.all([1, 2]);",
    expectedRules: ["taimei(no-promise-all)"],
  },
  {
    name: "runBackground は background.ts だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe038.ts",
    source: "export const r = () => runBackground(1);",
    expectedRules: ["taimei(run-background-only-in-background)"],
  },
  {
    name: "runBackground は background.ts だけ: src では lint が止めない",
    path: "src/background.ts",
    source: "export const r = () => runBackground(1);",
    expectedRules: [],
  },
  {
    name: "Sentry facade の直呼びは sentry.ts と client-facing-error.ts だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe039.ts",
    source: "export const r = (e: unknown) => Sentry.captureException(e);",
    expectedRules: ["taimei(sentry-capture-only-in-sentry-facade)"],
  },
  {
    name: "Sentry facade の直呼びは sentry.ts と client-facing-error.ts だけ: src では lint が止めない",
    path: "src/sentry.ts",
    source: "export const r = (e: unknown) => Sentry.captureException(e);",
    expectedRules: [],
  },
  {
    name: "audit log の書き込みは audit/append.ts だけ: src/company に書くと lint が止める",
    path: "src/company/Probe040.ts",
    source: "export const r = (repo: { appendAuditLog(): void }) => repo.appendAuditLog();",
    expectedRules: ["taimei(audit-append-only-in-append)"],
  },
  {
    name: "audit log の書き込みは audit/append.ts だけ: src/audit では lint が止めない",
    path: "src/audit/append.ts",
    source: "export const r = (repo: { appendAuditLog(): void }) => repo.appendAuditLog();",
    expectedRules: [],
  },
  {
    name: "silent な fold: orElseSucceed: src/membership に書くと lint が止める",
    path: "src/membership/Probe041.ts",
    source: "export const r = Effect.orElseSucceed;",
    expectedRules: ["taimei(no-or-else-succeed)"],
  },
  {
    name: "silent な fold: Effect.ignore: src/membership に書くと lint が止める",
    path: "src/membership/Probe042.ts",
    source: "export const r = Effect.ignore;",
    expectedRules: ["taimei(no-effect-ignore)"],
  },
  {
    name: "silent な fold: Effect.ignore: src/membership では lint が止めない",
    path: "src/membership/Probe043.ts",
    source: "export const r = Effect.ignoreLogged;",
    expectedRules: [],
  },
  {
    name: "Effect.logError は email/client.ts だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe044.ts",
    source: 'export const r = Effect.logError("x");',
    expectedRules: ["taimei(log-error-only-in-email-client)"],
  },
  {
    name: "Effect.logError は email/client.ts だけ: src/email では lint が止めない",
    path: "src/email/client.ts",
    source: 'export const r = Effect.logError("x");',
    expectedRules: [],
  },
  {
    name: "captureCause の直呼びは fail-closed / void の 11 file だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe045.ts",
    source: "export const r = captureCause({ cause: 1 });",
    expectedRules: ["taimei(capture-cause-only-in-listed-files)"],
  },
  {
    name: "captureCause の直呼びは fail-closed / void の 11 file だけ: src/membership では lint が止めない",
    path: "src/membership/Probe046.ts",
    source: "export const r = captureCauseAs(null, {});",
    expectedRules: [],
  },
  {
    name: "incrementRateWindow は attempt-budget だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe047.ts",
    source: 'export const r = incrementRateWindow("k");',
    expectedRules: ["taimei(increment-rate-window-only-in-attempt-budget)"],
  },
  {
    name: "incrementRateWindow は attempt-budget だけ: src では lint が止めない",
    path: "src/ttl-store.ts",
    source: 'export const r = incrementRateWindow("k");',
    expectedRules: [],
  },
  {
    name: "membership 行の増減と role 変更は apply-change だけ: src/company に書くと lint が止める",
    path: "src/company/Probe048.ts",
    source: "export const r = (repo: { insertMembership(): void }) => repo.insertMembership();",
    expectedRules: ["taimei(membership-write-only-in-apply-change)"],
  },
  {
    name: "membership 行の増減と role 変更は apply-change だけ: src/membership では lint が止めない",
    path: "src/membership/apply-change.ts",
    source: "export const r = (repo: { insertMembership(): void }) => repo.insertMembership();",
    expectedRules: [],
  },
  {
    name: "現在の事業所の書き込みは current-company だけ: src/company に書くと lint が止める",
    path: "src/company/Probe049.ts",
    source:
      "export const r = (repo: { updateUserLastUsedCompany(): void }) => repo.updateUserLastUsedCompany();",
    expectedRules: ["taimei(last-used-company-write-only-in-current-company)"],
  },
  {
    name: "現在の事業所の書き込みは current-company だけ: src/membership では lint が止めない",
    path: "src/membership/current-company.ts",
    source:
      "export const r = (repo: { updateUserLastUsedCompany(): void }) => repo.updateUserLastUsedCompany();",
    expectedRules: [],
  },
  {
    name: "settleCause / captureThrown は adapter と better-auth の結線だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe050.ts",
    source: "export const r = settleCause(1);",
    expectedRules: ["taimei(settle-cause-only-in-adapters)"],
  },
  {
    name: "settleCause / captureThrown は adapter と better-auth の結線だけ: src/handlers では lint が止めない",
    path: "src/handlers/run-route.ts",
    source: "export const r = settleCause(1);",
    expectedRules: [],
  },
  {
    name: "authApiLayer は run-route.ts だけ (識別子): src/handlers に書くと lint が止める",
    path: "src/handlers/Probe051.ts",
    source: "export const layer = authApiLayer;",
    expectedRules: ["taimei(auth-api-layer-only-in-run-route)"],
  },
  {
    name: "authApiLayer は run-route.ts だけ (識別子): src/handlers では lint が止めない",
    path: "src/handlers/run-route.ts",
    source: "export const layer = authApiLayer;",
    expectedRules: [],
  },
  {
    name: "authApiLayer を production で set しない (key の文字列): src/handlers に書くと lint が止める",
    path: "src/handlers/Probe052.ts",
    source:
      'export const set = (c: { set(k: string, v: unknown): void }) => c.set("authApiLayer", 1);',
    expectedRules: ["taimei(auth-api-layer-only-in-run-route)"],
  },
  {
    name: "authApiLayer を production で set しない (key の文字列): src/handlers では lint が止めない",
    path: "src/handlers/run-route.ts",
    source: 'export const get = (c: { get(k: string): unknown }) => c.get("authApiLayer");',
    expectedRules: [],
  },
  {
    name: "better-auth の auth instance を値で import するのは app.ts と auth-wiring.ts だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe053.ts",
    source: 'import { auth } from "../auth"; export const a = auth;',
    expectedRules: [
      "taimei(auth-instance-import-only-in-app-and-auth-wiring)",
      "taimei(auth-module-import-only-in-entry-files)",
    ],
  },
  {
    name: "better-auth の auth instance を値で import するのは app.ts と auth-wiring.ts だけ: src では lint が止めない",
    path: "src/boot.ts",
    source: 'import { initAuth } from "./auth"; export const a = initAuth;',
    expectedRules: [],
  },
  {
    name: "auth module を値で import するのは app.ts・auth-wiring.ts・boot.ts だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe054.ts",
    source: 'import { initAuth } from "../auth"; export const a = initAuth;',
    expectedRules: ["taimei(auth-module-import-only-in-entry-files)"],
  },
  {
    name: "auth module を値で import するのは app.ts・auth-wiring.ts・boot.ts だけ: src/membership では lint が止めない",
    path: "src/membership/Probe055.ts",
    source: 'import type { Auth } from "../auth"; export type A = Auth;',
    expectedRules: [],
  },
  {
    name: "initRuntime と initAuth を呼ぶのは boot.ts だけ: management に書くと lint が止める",
    path: "management/Probe056.ts",
    source: "export const r = initRuntime(1);",
    expectedRules: ["taimei(init-runtime-only-in-boot)"],
  },
  {
    name: "initRuntime と initAuth を呼ぶのは boot.ts だけ: src では lint が止めない",
    path: "src/boot.ts",
    source: "export const r = initRuntime(1);",
    expectedRules: [],
  },
  {
    name: "AuthApi.issueSession はログインの成立の手順 establish-sign-in.ts だけ: src/mfa に書くと lint が止める",
    path: "src/mfa/Probe057.ts",
    source: "export const r = (api: { issueSession(): void }) => api.issueSession();",
    expectedRules: ["taimei(issue-session-only-in-establish-sign-in)"],
  },
  {
    name: "ログインの成立の手順を import するのは資格情報の検証を終えた complete-login-challenge.ts だけ: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe058.ts",
    source:
      'import { establishSignIn } from "../establish-sign-in"; export const r = establishSignIn;',
    expectedRules: ["taimei(establish-sign-in-only-after-credential-check)"],
  },
  {
    name: "ログインの成立の手順を import するのは資格情報の検証を終えた complete-login-challenge.ts だけ: src/passkey に書くと lint が止める",
    path: "src/passkey/Probe059.ts",
    source: 'export const load = () => import("../establish-sign-in");',
    expectedRules: ["taimei(establish-sign-in-only-after-credential-check)"],
  },
  {
    name: "ログインの成立の手順を import するのは資格情報の検証を終えた complete-login-challenge.ts だけ: testing に書くと lint が止める",
    path: "testing/Probe060.ts",
    source: 'import * as signIn from "../src/establish-sign-in"; export const r = signIn;',
    expectedRules: ["taimei(establish-sign-in-only-after-credential-check)"],
  },
  {
    name: "ログインの成立の手順を import するのは資格情報の検証を終えた complete-login-challenge.ts だけ: src/mfa/totp では lint が止めない",
    path: "src/mfa/totp/complete-login-challenge.ts",
    source:
      'import { establishSignIn } from "../../establish-sign-in"; export const r = establishSignIn;',
    expectedRules: [],
  },
  {
    name: "AuthApi.getSession は session-check.ts だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe061.ts",
    source: "export const r = (api: { getSession(): void }) => api.getSession();",
    expectedRules: ["taimei(get-session-only-in-session-check)"],
  },
  {
    name: "AuthApi.getSession は session-check.ts だけ: src では lint が止めない",
    path: "src/session-check.ts",
    source: "export const r = (api: { getSession(): void }) => api.getSession();",
    expectedRules: [],
  },
  {
    name: "better-auth の APIError の形を読むのは auth-wiring.ts だけ (member): src/membership に書くと lint が止める",
    path: "src/membership/Probe062.ts",
    source: "export const code = (cause: { body: { code: string } }) => cause.body.code;",
    expectedRules: ["taimei(api-error-shape-only-in-auth-wiring)"],
  },
  {
    name: "better-auth の APIError の形を読むのは auth-wiring.ts だけ (member): src では lint が止めない",
    path: "src/auth-wiring.ts",
    source: "export const code = (cause: { body: { code: string } }) => cause.body.code;",
    expectedRules: [],
  },
  {
    name: "better-auth の APIError の形を読むのは auth-wiring.ts だけ (member) (UNAUTHORIZED の文字列): src/membership に書くと lint が止める",
    path: "src/membership/Probe063.ts",
    source: 'export const code = "UNAUTHORIZED";',
    expectedRules: ["taimei(api-error-shape-only-in-auth-wiring)"],
  },
  {
    name: "better-auth の APIError の形を読むのは auth-wiring.ts だけ (member) (UNAUTHORIZED の文字列): src では lint が止めない",
    path: "src/auth-wiring.ts",
    source: 'export const code = "UNAUTHORIZED";',
    expectedRules: [],
  },
  {
    name: "src の test の @/db runtime import は test-db.ts だけ: src/membership/__tests__ に書くと lint が止める",
    path: "src/membership/__tests__/Probe064.ts",
    source: 'import { db } from "@/db/client"; export const d = db;',
    expectedRules: [
      "taimei(db-import-in-src-tests-only-in-test-db)",
      "taimei(db-value-import-only-in-db-in-tests)",
    ],
  },
  {
    name: "src の test の @/db runtime import は test-db.ts だけ: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe065.ts",
    source: 'import type { UserRow } from "@/db/schema"; export type U = UserRow;',
    expectedRules: [],
  },
  {
    name: "e2e の @/db runtime import は db/testing/* だけ: e2e に書くと lint が止める",
    path: "e2e/Probe066.ts",
    source: 'import { db } from "@/db/client"; export const d = db;',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)", "taimei(db-import-only-in-db)"],
  },
  {
    name: "e2e の @/db runtime import は db/testing/* だけ: e2e では lint が止めない",
    path: "e2e/fixtures.ts",
    source: 'import { createSeed } from "@/db/testing/seed"; export const s = createSeed;',
    expectedRules: [],
  },
  {
    name: "e2e の @/db runtime import は fixtures.ts だけ: e2e に書くと lint が止める",
    path: "e2e/Probe067.ts",
    source: 'import { createSeed } from "@/db/testing/seed"; export const s = createSeed;',
    expectedRules: ["taimei(db-testing-import-only-in-listed-files)"],
  },
  {
    name: "e2e の @/db runtime import は fixtures.ts だけ: e2e では lint が止めない",
    path: "e2e/fixtures.ts",
    source: 'import { createSeed } from "@/db/testing/seed"; export const s = createSeed;',
    expectedRules: [],
  },
  {
    name: "src の Layer constructor は succeed / mergeAll / provide と決まった 2 file だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe068.ts",
    source: "export const l = Layer.effect(Service, make);",
    expectedRules: ["taimei(no-failing-layer-constructor-in-src)"],
  },
  {
    name: "src の Layer constructor は succeed / mergeAll / provide と決まった 2 file だけ: src/membership では lint が止めない",
    path: "src/membership/Probe069.ts",
    source: "export const l = Layer.succeed(Service, value);",
    expectedRules: [],
  },
  {
    name: "src の Layer constructor は succeed / mergeAll / provide と決まった 2 file だけ: src/membership では lint が止めない",
    path: "src/membership/Probe070.ts",
    source: "export const m = Layer.mergeAll(a, b);",
    expectedRules: [],
  },
  {
    name: "directive 以外のコメントが 0 件: src/membership に書くと lint が止める",
    path: "src/membership/Probe071.ts",
    source: "export const x = 1; // note",
    expectedRules: ["taimei(no-code-comment)"],
  },
  {
    name: "directive 以外のコメントが 0 件: src/membership では lint が止めない",
    path: "src/membership/Probe072.ts",
    source: 'export const url = "http://example.com";',
    expectedRules: [],
  },
  {
    name: "directive 以外のコメントが 0 件: src/membership では lint が止めない",
    path: "src/membership/Probe073.ts",
    source: '/// <reference types="vite/client" />',
    expectedRules: [],
  },
  {
    name: "directive 以外のコメントが 0 件: src/membership では lint が止めない",
    path: "src/membership/Probe074.ts",
    source: "// oxlint-disable-next-line no-unused-vars -- 理由\nconst y = 1;",
    expectedRules: [],
  },
  {
    name: "directive 以外のコメントが 0 件: web/src/shared では lint が止めない",
    path: "web/src/shared/Probe075.ts",
    source: 'export const v = import(/* @vite-ignore */ "x");',
    expectedRules: [],
  },
  {
    name: "test 名と .each の行ラベルに設計書の番号が無い: src/membership/__tests__ に書くと lint が止める",
    path: "src/membership/__tests__/Probe076.test.ts",
    source: 'test("AC-001: 失敗を返す", () => {});',
    expectedRules: ["taimei(no-design-number-in-test-name)"],
  },
  {
    name: "test 名と .each の行ラベルに設計書の番号が無い: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe077.test.ts",
    source: 'test("QA-MR-02 の手順で確かめる", () => {});',
    expectedRules: [],
  },
  {
    name: "test 名と .each の行ラベルに設計書の番号が無い: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe078.test.ts",
    source: 'test.each(["AC-001: x"])("振る舞いの文 %s", () => {});',
    expectedRules: [],
  },
  {
    name: "AUTH_TRUSTED_PROXY_HOPS を読む production file は request-context.ts だけ: src/audit に書くと lint が止める",
    path: "src/audit/Probe079.ts",
    source: "export const hops = process.env.AUTH_TRUSTED_PROXY_HOPS;",
    expectedRules: ["taimei(proxy-hops-env-only-in-request-context)"],
  },
  {
    name: "AUTH_TRUSTED_PROXY_HOPS を読む production file は request-context.ts だけ: src では lint が止めない",
    path: "src/request-context.ts",
    source: "export const hops = process.env.AUTH_TRUSTED_PROXY_HOPS;",
    expectedRules: [],
  },
  {
    name: "app に request を渡す (app.fetch) のは 2 つの入口だけ: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe080.ts",
    source: "export const r = (req: Request) => app.fetch(req);",
    expectedRules: ["taimei(app-fetch-only-in-entry-files)"],
  },
  {
    name: "app に request を渡す (app.fetch) のは 2 つの入口だけ: testing では lint が止めない",
    path: "testing/bun-server.ts",
    source: "export const r = (req: Request) => app.fetch(req);",
    expectedRules: [],
  },
  {
    name: "AUTH_SERVICE_KEY の読み手は service-key.ts と testing/server.ts だけ: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe081.ts",
    source: "export const key = process.env.AUTH_SERVICE_KEY;",
    expectedRules: ["taimei(service-key-env-only-in-service-key)"],
  },
  {
    name: "AUTH_SERVICE_KEY の読み手は service-key.ts と testing/server.ts だけ: src では lint が止めない",
    path: "src/service-key.ts",
    source: "export const key = process.env.AUTH_SERVICE_KEY;",
    expectedRules: [],
  },
  {
    name: "鍵の比較に includes を使わない: src に書くと lint が止める",
    path: "src/service-key.ts",
    source: "export const ok = (keys: string[], presented: string) => keys.includes(presented);",
    expectedRules: ["taimei(service-key-compare-only-in-timing-safe-equal)"],
  },
  {
    name: "鍵の比較に === を使わない: src に書くと lint が止める",
    path: "src/service-key.ts",
    source: "export const ok = (key: string, presented: string) => key === presented;",
    expectedRules: ["taimei(service-key-compare-only-in-timing-safe-equal)"],
  },
  {
    name: "X-Service-Key header の読み手は app.ts だけ: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe082.ts",
    source:
      'export const h = (c: { req: { header(name: string): string } }) => c.req.header("X-Service-Key");',
    expectedRules: ["taimei(service-key-header-only-in-app)"],
  },
  {
    name: "X-Service-Key header の読み手は app.ts だけ: src では lint が止めない",
    path: "src/app.ts",
    source:
      'export const h = (c: { req: { header(name: string): string } }) => c.req.header("X-Service-Key");',
    expectedRules: [],
  },
  {
    name: "手書きの応答 body (c.json({ error:) が無い: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe083.ts",
    source: 'export const r = (c: { json(body: unknown): unknown }) => c.json({ error: "x" });',
    expectedRules: ["taimei(no-hand-written-error-body)"],
  },
  {
    name: "手書きの応答 body (c.json({ error:) が無い: src/handlers では lint が止めない",
    path: "src/handlers/Probe084.ts",
    source:
      "export const r = (c: { json(body: unknown, status: number): unknown }, report: object) => c.json({ ...report }, 200);",
    expectedRules: [],
  },
  {
    name: "Sentry の SDK を import するのは runtime ごとの初期化 file と worker.ts だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe085.ts",
    source: 'import * as Sentry from "@sentry/bun"; export const s = Sentry;',
    expectedRules: ["taimei(sentry-sdk-import-only-in-init-files)"],
  },
  {
    name: "Sentry の SDK を import するのは runtime ごとの初期化 file と worker.ts だけ: src/membership では lint が止めない",
    path: "src/membership/Probe086.ts",
    source: 'import type { Event } from "@sentry/core"; export type E = Event;',
    expectedRules: [],
  },
  {
    name: "auth-plugins が import してよい mfa の module は 3 つに限る: src/auth-plugins に書くと lint が止める",
    path: "src/auth-plugins/Probe087.ts",
    source: 'import { enroll } from "../mfa/totp"; export const e = enroll;',
    expectedRules: ["taimei(listed-mfa-import-only-in-auth-plugins)"],
  },
  {
    name: "auth-plugins が import してよい mfa の module は 3 つに限る: src/auth-plugins では lint が止めない",
    path: "src/auth-plugins/mfa-challenge.ts",
    source: 'import { guard } from "../mfa/totp/challenge-required"; export const g = guard;',
    expectedRules: [],
  },
  {
    name: "kill switch の env を読むのは一次認証の after-hook だけ: src/mfa に書くと lint が止める",
    path: "src/mfa/Probe088.ts",
    source: "export const on = process.env.MFA_CHALLENGE_ENABLED;",
    expectedRules: ["taimei(mfa-kill-switch-env-only-in-primary-auth)"],
  },
  {
    name: "kill switch の env を読むのは一次認証の after-hook だけ: src/auth-plugins では lint が止めない",
    path: "src/auth-plugins/primary-auth.ts",
    source: "export const on = process.env.MFA_CHALLENGE_ENABLED;",
    expectedRules: [],
  },
  {
    name: "cookie の属性を手で書かない: src/mfa/totp に書くと lint が止める",
    path: "src/mfa/totp/Probe089.ts",
    source: 'export const cookie = "sid=1; HttpOnly";',
    expectedRules: ["taimei(no-hand-written-cookie-attribute)"],
  },
  {
    name: "db/repositories/mfa-totp を import する production code は決まった file だけ: src/auth-plugins に書くと lint が止める",
    path: "src/auth-plugins/Probe090.ts",
    source:
      'import type { MfaTotpRow } from "@/db/repositories/mfa-totp"; export type R = MfaTotpRow;',
    expectedRules: ["taimei(mfa-totp-repo-only-in-listed-files)"],
  },
  {
    name: "db/repositories/mfa-totp を import する production code は決まった file だけ: src/mfa/totp では lint が止めない",
    path: "src/mfa/totp/ports.ts",
    source:
      'import type { MfaTotpRow } from "@/db/repositories/mfa-totp"; export type R = MfaTotpRow;',
    expectedRules: [],
  },
  {
    name: "チャレンジの cookie 名の文字列は login-challenge.ts だけ: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe091.ts",
    source: 'export const name = "mfa_login_challenge";',
    expectedRules: ["taimei(login-cookie-name-only-in-login-challenge)"],
  },
  {
    name: "チャレンジの cookie 名の文字列は login-challenge.ts だけ: src/mfa/totp では lint が止めない",
    path: "src/mfa/totp/login-challenge.ts",
    source: 'export const name = "mfa_login_challenge";',
    expectedRules: [],
  },
  {
    name: "secret を返す findMfaTotp を使う code は決まった file だけ: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe092.ts",
    source: 'export const r = findMfaTotp("u");',
    expectedRules: ["taimei(find-mfa-totp-only-in-listed-files)"],
  },
  {
    name: "secret を返す findMfaTotp を使う code は決まった file だけ: src/mfa/totp では lint が止めない",
    path: "src/mfa/totp/verify-code.ts",
    source: 'export const r = findMfaTotp("u");',
    expectedRules: [],
  },
  {
    name: "verifiedAt を読む production code は policy.ts だけ: src/mfa に書くと lint が止める",
    path: "src/mfa/Probe093.ts",
    source: "export const at = (row: { verifiedAt: Date }) => row.verifiedAt;",
    expectedRules: ["taimei(verified-at-only-in-mfa-policy)"],
  },
  {
    name: "verifiedAt を読む production code は policy.ts だけ: src/mfa では lint が止めない",
    path: "src/mfa/policy.ts",
    source: "export const at = (row: { verifiedAt: Date }) => row.verifiedAt;",
    expectedRules: [],
  },
  {
    name: "パスキーの数の上限と比べるのは保存の文と述語だけ: 画面に書くと lint が止める",
    path: "web/src/passkey/Probe494.ts",
    source: "export const full = (count: number) => count >= PASSKEY_LIMIT;",
    expectedRules: ["taimei(passkey-limit-only-in-passkey-policy)"],
  },
  {
    name: "パスキーの数の上限と比べるのは保存の文と述語だけ: src/passkey/policy.ts では lint が止めない",
    path: "src/passkey/policy.ts",
    source: "export const full = (count: number) => count >= PASSKEY_LIMIT;",
    expectedRules: [],
  },
  {
    name: "management/ の import 面は全列挙で固定する: management に書くと lint が止める",
    path: "management/Probe094.ts",
    source: 'import { db } from "../db/client"; export const d = db;',
    expectedRules: ["taimei(db-import-only-in-db)", "taimei(listed-import-only-in-management)"],
  },
  {
    name: "management/ の import 面は全列挙で固定する: management では lint が止めない",
    path: "management/disable-user-mfa.ts",
    source: 'import { boot } from "../src/boot"; export const b = boot;',
    expectedRules: [],
  },
  {
    name: "db/ は src/ を import しない: db/repositories に書くと lint が止める",
    path: "db/repositories/Probe095.ts",
    source: 'import { failure } from "../../src/failures"; export const f = failure;',
    expectedRules: ["taimei(no-src-import-in-db)"],
  },
  {
    name: "policy.ts は import 0 件: src/mfa に書くと lint が止める",
    path: "src/mfa/policy.ts",
    source: 'import { Effect } from "effect"; export const x = Effect;',
    expectedRules: ["taimei(no-import-in-mfa-policy)"],
  },
  {
    name: "guard/*.ts・policy.ts・accept.ts は型も値も hono を import しない: src/membership/guard に書くと lint が止める",
    path: "src/membership/guard/Probe096.ts",
    source: 'import type { Context } from "hono"; export type C = Context;',
    expectedRules: ["taimei(no-hono-in-guard)"],
  },
  {
    name: "Verified への cast は guard の中だけ: src/company に書くと lint が止める",
    path: "src/company/Probe097.ts",
    source: "export const v = {} as Verified<object>;",
    expectedRules: ["taimei(verified-only-in-guard)"],
  },
  {
    name: "Verified への cast は guard の中だけ: src/membership/guard では lint が止めない",
    path: "src/membership/guard/Probe098.ts",
    source: "export const v = {} as Verified<object>;",
    expectedRules: [],
  },
  {
    name: "印を付ける verified を呼ぶのは guard の中だけ: src/company に書くと lint が止める",
    path: "src/company/Probe099.ts",
    source: "export const v = verified({});",
    expectedRules: ["taimei(verified-only-in-guard)"],
  },
  {
    name: "印を付ける verified を呼ぶのは guard の中だけ: src/membership/guard では lint が止めない",
    path: "src/membership/guard/Probe100.ts",
    source: "export const v = verified({});",
    expectedRules: [],
  },
  {
    name: "sole OWNER の検査と OWNER 行の lock は delete-account.ts だけ: src/company に書くと lint が止める",
    path: "src/company/Probe101.ts",
    source: 'export const r = findCompaniesBlockingUserDeletion("u");',
    expectedRules: ["taimei(account-deletion-only-in-delete-account)"],
  },
  {
    name: "sole OWNER の検査と OWNER 行の lock は delete-account.ts だけ: src/account では lint が止めない",
    path: "src/account/delete-account.ts",
    source: 'export const r = findCompaniesBlockingUserDeletion("u");',
    expectedRules: [],
  },
  {
    name: "deleteAccount を呼ぶのは delete-account.ts と orphan.ts だけ: src/company に書くと lint が止める",
    path: "src/company/Probe102.ts",
    source: 'export const r = deleteAccount("u");',
    expectedRules: ["taimei(delete-account-only-in-delete-account-and-orphan)"],
  },
  {
    name: "deleteAccount を呼ぶのは delete-account.ts と orphan.ts だけ: src/account では lint が止めない",
    path: "src/account/orphan.ts",
    source: 'export const r = deleteAccount("u");',
    expectedRules: [],
  },
  {
    name: ".deleteUser は delete-account.ts だけ: src/company に書くと lint が止める",
    path: "src/company/Probe103.ts",
    source: "export const r = (api: { deleteUser(): void }) => api.deleteUser();",
    expectedRules: ["taimei(account-deletion-only-in-delete-account)"],
  },
  {
    name: ".deleteUser は delete-account.ts だけ: src/account では lint が止めない",
    path: "src/account/delete-account.ts",
    source: "export const r = (api: { deleteUser(): void }) => api.deleteUser();",
    expectedRules: [],
  },
  {
    name: "OWNER 行の lock は全て id 順に取る: db/repositories に書くと lint が止める",
    path: "db/repositories/membership.ts",
    source: "export const q = sql`SELECT id FROM membership WHERE role = 'OWNER' FOR UPDATE`;",
    expectedRules: ["taimei(no-unordered-owner-lock)"],
  },
  {
    name: "OWNER 行の lock は全て id 順に取る: db/repositories では lint が止めない",
    path: "db/repositories/membership.ts",
    source:
      "export const q = sql`SELECT id FROM membership WHERE role = 'OWNER' ORDER BY id FOR UPDATE`;",
    expectedRules: [],
  },
  {
    name: "better-auth の退会 endpoint を有効にしない: src に書くと lint が止める",
    path: "src/auth.ts",
    source: "export const config = { user: { deleteUser: { enabled: true } } };",
    expectedRules: ["taimei(no-better-auth-delete-user)"],
  },
  {
    name: "deleteUserSessions を呼ぶのは delete-sessions.ts と auth-wiring.ts だけ: src/account に書くと lint が止める",
    path: "src/account/Probe104.ts",
    source:
      "export const r = (store: { deleteUserSessions(): void }) => store.deleteUserSessions();",
    expectedRules: ["taimei(delete-user-sessions-only-in-delete-sessions)"],
  },
  {
    name: "deleteUserSessions を呼ぶのは delete-sessions.ts と auth-wiring.ts だけ: src/account では lint が止めない",
    path: "src/account/delete-sessions.ts",
    source:
      "export const r = (store: { deleteUserSessions(): void }) => store.deleteUserSessions();",
    expectedRules: [],
  },
  {
    name: "deleteSessionsOf を呼ぶのは delete-account.ts だけ: src/company に書くと lint が止める",
    path: "src/company/Probe105.ts",
    source: 'export const r = deleteSessionsOf("u");',
    expectedRules: ["taimei(account-deletion-only-in-delete-account)"],
  },
  {
    name: "deleteSessionsOf を呼ぶのは delete-account.ts だけ: src/account では lint が止めない",
    path: "src/account/delete-account.ts",
    source: 'export const r = deleteSessionsOf("u");',
    expectedRules: [],
  },
  {
    name: "一次認証 route と provider の literal 比較は primary-auth-routes.ts だけ: src/auth-plugins に書くと lint が止める",
    path: "src/auth-plugins/Probe106.ts",
    source: 'export const path = "/magic-link/verify";',
    expectedRules: ["taimei(route-literals-only-in-primary-auth-routes)"],
  },
  {
    name: "一次認証 route と provider の literal 比較は primary-auth-routes.ts だけ: src/auth-plugins では lint が止めない",
    path: "src/auth-plugins/primary-auth-routes.ts",
    source: 'export const path = "/magic-link/verify";',
    expectedRules: [],
  },
  {
    name: "DisplayText への cast は sanitize.ts の toDisplayText だけ: src/email に書くと lint が止める",
    path: "src/email/Probe107.ts",
    source: 'export const t = "raw" as DisplayText;',
    expectedRules: ["taimei(display-text-cast-only-in-sanitize)"],
  },
  {
    name: "DisplayText への cast は sanitize.ts の toDisplayText だけ: src/email では lint が止めない",
    path: "src/email/sanitize.ts",
    source: 'export const t = "raw" as DisplayText;',
    expectedRules: [],
  },
  {
    name: "probe の呼び手は probe.ts だけ: src/handlers に書くと lint が止める",
    path: "src/handlers/Probe108.ts",
    source: "export const r = (db: { ping(): void }) => db.ping();",
    expectedRules: ["taimei(health-ping-only-in-probe)"],
  },
  {
    name: "probe の呼び手は probe.ts だけ: src/health では lint が止めない",
    path: "src/health/probe.ts",
    source: "export const r = (db: { ping(): void }) => db.ping();",
    expectedRules: [],
  },
  {
    name: "repository と driver は失敗を握らない (catch が無い): db/repositories に書くと lint が止める",
    path: "db/repositories/health.ts",
    source:
      "export const ping = async () => { try { await Promise.resolve(); } catch { return; } };",
    expectedRules: ["taimei(no-catch-in-health-drivers)"],
  },
  {
    name: 'app.ts に `app.get("/health"` を書かない: src に書くと lint が止める',
    path: "src/app.ts",
    source: 'export const r = (app: { get(path: string): void }) => app.get("/health");',
    expectedRules: ["taimei(health-route-only-in-health-handler)"],
  },
  {
    name: "app.ts は health/ports と ttl-store-service を直接触らない: src に書くと lint が止める",
    path: "src/app.ts",
    source: 'import { HealthPorts } from "./health/ports"; export const p = HealthPorts;',
    expectedRules: ["taimei(health-route-only-in-health-handler)"],
  },
  {
    name: "handlers/health.ts は runtime を直接呼ばない: src/handlers に書くと lint が止める",
    path: "src/handlers/health.ts",
    source: "export const r = () => Effect.runPromise(program);",
    expectedRules: [
      "taimei(effect-run-only-in-listed-files)",
      "taimei(no-direct-runtime-in-health-handler)",
    ],
  },
  {
    name: "local の host の集合で判定するのは local-database.ts だけ: db に書くと lint が止める",
    path: "db/Probe109.ts",
    source: "export const local = (host: string) => LOCAL_DATABASE_HOSTNAMES.has(host);",
    expectedRules: ["taimei(local-hostname-check-only-in-local-database)"],
  },
  {
    name: "local の host の集合で判定するのは local-database.ts だけ: db/testing では lint が止めない",
    path: "db/testing/local-database.ts",
    source: "export const local = (host: string) => LOCAL_DATABASE_HOSTNAMES.has(host);",
    expectedRules: [],
  },
  {
    name: "DATABASE_URL を URL として読む file が無い: db に書くと lint が止める",
    path: "db/Probe110.ts",
    source: "export const host = new URL(process.env.DATABASE_URL!).hostname;",
    expectedRules: ["taimei(local-hostname-check-only-in-local-database)"],
  },
  {
    name: "AuthApi.createUser を呼ぶのは試験の利用者を作る use-case だけ: src/membership に書くと lint が止める",
    path: "src/membership/Probe111.ts",
    source: "export const r = (api: { createUser(): void }) => api.createUser();",
    expectedRules: ["taimei(create-user-only-in-test-user-use-case)"],
  },
  {
    name: "AuthApi.createUser を呼ぶのは試験の利用者を作る use-case だけ: testing では lint が止めない",
    path: "testing/create-signed-in-user.ts",
    source: "export const r = (api: { createUser(): void }) => api.createUser();",
    expectedRules: [],
  },
  {
    name: "testing/ で APP_ENV を読むのは判定の file と isOutsideProduction に渡す行だけ: testing に書くと lint が止める",
    path: "testing/Probe112.ts",
    source: 'export const production = process.env.APP_ENV === "production";',
    expectedRules: ["taimei(app-env-only-in-outside-production-check)"],
  },
  {
    name: "testing/ で APP_ENV を読むのは判定の file と isOutsideProduction に渡す行だけ: testing では lint が止めない",
    path: "testing/server.ts",
    source: "if (!isOutsideProduction(process.env.APP_ENV)) { process.exit(1); }",
    expectedRules: [],
  },
  {
    name: "runtime.ts は db/client と ttl-store を値で import しない: src に書くと lint が止める",
    path: "src/runtime.ts",
    source: 'import { Pool } from "pg"; export const p = Pool;',
    expectedRules: ["taimei(db-import-only-in-db)", "taimei(no-io-resource-import-in-runtime)"],
  },
  {
    name: "runtime.ts は db/client と ttl-store を値で import しない: src では lint が止めない",
    path: "src/runtime.ts",
    source: 'import type { Pool } from "pg"; export type P = Pool;',
    expectedRules: [],
  },
  {
    name: "試験の module で現在の事業所を書き換えるのは 2 つの use-case だけ: testing に書くと lint が止める",
    path: "testing/Probe113.ts",
    source: 'export const r = switchCurrentCompany({ userId: "u", companyId: "c" });',
    expectedRules: ["taimei(current-company-write-only-in-testing-use-cases)"],
  },
  {
    name: "試験の module で現在の事業所を書き換えるのは 2 つの use-case だけ: testing では lint が止めない",
    path: "testing/set-current-company.ts",
    source: 'export const r = switchCurrentCompany({ userId: "u", companyId: "c" });',
    expectedRules: [],
  },
  {
    name: "directive 以外のコメント: src/membership に書くと lint が止める",
    path: "src/membership/Probe114.ts",
    source: "export const a = 1; // trailing",
    expectedRules: ["taimei(no-code-comment)"],
  },
  {
    name: "directive 以外のコメント: src/membership に書くと lint が止める",
    path: "src/membership/Probe115.ts",
    source: "/* block */\nexport const b = 1;",
    expectedRules: ["taimei(no-code-comment)"],
  },
  {
    name: "directive 以外のコメント: src/membership に書くと lint が止める",
    path: "src/membership/Probe116.ts",
    source: "export const t = (x: number) => `a$" + "{/* inner */ x}`;",
    expectedRules: ["taimei(no-code-comment)"],
  },
  {
    name: "directive 以外のコメント: src/membership に書くと lint が止める",
    path: "src/membership/Probe117.ts",
    source: "// eslint-disable-next-line no-console\nexport const c = 1;",
    expectedRules: ["taimei(no-code-comment)"],
  },
  {
    name: "directive 以外のコメント: src/membership に書くと lint が止める",
    path: "src/membership/Probe118.ts",
    source: "// biome-ignore lint/style: x\nexport const d = 1;",
    expectedRules: ["taimei(no-code-comment)"],
  },
  {
    name: "文字列・正規表現・template・除算と directive: src/membership では lint が止めない",
    path: "src/membership/Probe119.ts",
    source: "export const re = /\\/\\//g;",
    expectedRules: [],
  },
  {
    name: "文字列・正規表現・template・除算と directive: src/membership では lint が止めない",
    path: "src/membership/Probe120.ts",
    source: "export const t = `a // b`;",
    expectedRules: [],
  },
  {
    name: "文字列・正規表現・template・除算と directive: src/membership では lint が止めない",
    path: "src/membership/Probe121.ts",
    source: "export const q = (a: number, b: number, c: number) => a / b / c;",
    expectedRules: [],
  },
  {
    name: "文字列・正規表現・template・除算と directive: src/membership では lint が止めない",
    path: "src/membership/Probe122.ts",
    source: '// @ts-expect-error 型の検査\nexport const e: number = "x";',
    expectedRules: [],
  },
  {
    name: "文字列・正規表現・template・除算と directive: src/membership では lint が止めない",
    path: "src/membership/Probe123.ts",
    source: '/// <reference types="vite/client" />\nexport const r = 1;',
    expectedRules: [],
  },
  {
    name: "設計書の番号: src/membership/__tests__ に書くと lint が止める",
    path: "src/membership/__tests__/Probe124.test.ts",
    source: 'test("QA-H-02 事業所を切り替える", () => {});',
    expectedRules: ["taimei(no-design-number-in-test-name)"],
  },
  {
    name: "設計書の番号: src/membership/__tests__ に書くと lint が止める",
    path: "src/membership/__tests__/Probe125.test.ts",
    source: 'test("F-1 失敗の宣言", () => {});',
    expectedRules: ["taimei(no-design-number-in-test-name)"],
  },
  {
    name: "設計書の番号: src/membership/__tests__ に書くと lint が止める",
    path: "src/membership/__tests__/Probe126.test.ts",
    source: 'test("G1: token が無い", () => {});',
    expectedRules: ["taimei(no-design-number-in-test-name)"],
  },
  {
    name: "設計書の番号: src/membership/__tests__ に書くと lint が止める",
    path: "src/membership/__tests__/Probe127.test.ts",
    source: 'test("T1 発行した cookie を読む", () => {});',
    expectedRules: ["taimei(no-design-number-in-test-name)"],
  },
  {
    name: "設計書の番号: src/membership/__tests__ に書くと lint が止める",
    path: "src/membership/__tests__/Probe128.test.ts",
    source: 'test("Stage 2 ゲート", () => {});',
    expectedRules: ["taimei(no-design-number-in-test-name)"],
  },
  {
    name: "設計書の番号: src/membership/__tests__ に書くと lint が止める",
    path: "src/membership/__tests__/Probe129.test.ts",
    source: 'test("Hono の route の登録 (#52)", () => {});',
    expectedRules: ["taimei(no-design-number-in-test-name)"],
  },
  {
    name: "repo に定義のある番号と一般の用語: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe130.test.ts",
    source: 'test("ADR-0017 の境界を守る", () => {});',
    expectedRules: [],
  },
  {
    name: "repo に定義のある番号と一般の用語: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe131.test.ts",
    source: 'test("C0 制御文字の上端", () => {});',
    expectedRules: [],
  },
  {
    name: "repo に定義のある番号と一般の用語: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe132.test.ts",
    source: 'test("UTF-8 の文字列", () => {});',
    expectedRules: [],
  },
  {
    name: "repo に定義のある番号と一般の用語: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe133.test.ts",
    source: 'test("SHA-256 の digest", () => {});',
    expectedRules: [],
  },
  {
    name: "repo に定義のある番号と一般の用語: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe134.test.ts",
    source: 'test("RFC 6265 の cookie", () => {});',
    expectedRules: [],
  },
  {
    name: "-api.ts の名前でも fetch: web/src/mfa に書くと lint が止める",
    path: "web/src/mfa/mfa-api.ts",
    source: 'export const f = () => fetch("/x");',
    expectedRules: ["taimei(no-fetch-in-web)"],
  },
  {
    name: "cause を捨てる onFailure: web/src/company/pages に書くと lint が止める",
    path: "web/src/company/pages/ExitMatchProbe.ts",
    source:
      "export const r = (exit: unknown, Exit: { match: (e: unknown, h: unknown) => number }) => Exit.match(exit, { onSuccess: () => 1, onFailure: () => 0 });",
    expectedRules: ["taimei(no-ignored-cause-in-web)"],
  },
  {
    name: "e2e の @/db の値の import: e2e に書くと lint が止める",
    path: "e2e/Probe135.ts",
    source: 'import {\n  db,\n  schema,\n} from "@/db/client";\nexport const d = [db, schema];',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)", "taimei(db-import-only-in-db)"],
  },
  {
    name: "e2e の @/db の値の import: e2e に書くと lint が止める",
    path: "e2e/Probe136.ts",
    source: 'export const load = () => import("@/db/client");',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)", "taimei(db-import-only-in-db)"],
  },
  {
    name: "e2e の @/db の値の import: e2e に書くと lint が止める",
    path: "e2e/Probe137.ts",
    source: 'import "@/db/client";',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)", "taimei(db-import-only-in-db)"],
  },
  {
    name: "e2e の @/db の値の import: e2e に書くと lint が止める",
    path: "e2e/Probe138.ts",
    source: 'import db from "@/db/client";\nexport const d = db;',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)", "taimei(db-import-only-in-db)"],
  },
  {
    name: "e2e の @/db の値の import: e2e に書くと lint が止める",
    path: "e2e/Probe139.ts",
    source: 'export { db } from "@/db/client";',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)", "taimei(db-import-only-in-db)"],
  },
  {
    name: "src の test の @/db の型の import: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe140.ts",
    source: 'import type {\n  UserRow,\n} from "@/db/schema";\nexport type U = UserRow;',
    expectedRules: [],
  },
  {
    name: "src の test の @/db の型の import: src/membership/__tests__ では lint が止めない",
    path: "src/membership/__tests__/Probe141.ts",
    source: 'export type { DbTx } from "@/db/transaction";',
    expectedRules: [],
  },
  {
    name: "Effect.catchIf で _tag を比べる: web/src/company に書くと lint が止める",
    path: "web/src/company/Probe142.ts",
    source:
      'import { Effect } from "effect";\nexport const recover = (program: Effect.Effect<number, { readonly _tag: string }>) =>\n  program.pipe(Effect.catchIf((error) => error._tag === "Forbidden", () => Effect.succeed(0)));',
    expectedRules: ["taimei(no-tag-comparison-in-web)"],
  },
  {
    name: "PushUrl に /auth の router の path を渡す: web/src/app/account に書くと lint が止める",
    path: "web/src/app/account/Probe143.ts",
    source:
      'import * as DocumentNavigation from "../document-navigation";\nimport { signInRouter } from "../auth/route";\nexport const go = () => DocumentNavigation.PushUrl({ href: signInRouter({}) });',
    expectedRules: ["taimei(client-navigation-uses-own-routes)"],
  },
  {
    name: "foldkit の pushUrl に /auth の router の path を渡す: web/src/app/account に書くと lint が止める",
    path: "web/src/app/account/Probe144.ts",
    source:
      'import { pushUrl } from "foldkit/navigation";\nimport { signInRouter } from "../auth/route";\nexport const go = () => pushUrl(signInRouter({}));',
    expectedRules: ["taimei(client-navigation-uses-own-routes)"],
  },
  {
    name: "PushUrl に自分の application の router の path を渡す: web/src/app/account では lint が止めない",
    path: "web/src/app/account/Probe145.ts",
    source:
      'import * as DocumentNavigation from "../document-navigation";\nimport { companiesRouter } from "./route";\nexport const go = () => DocumentNavigation.PushUrl({ href: companiesRouter() });',
    expectedRules: [],
  },
  {
    name: "web/src に h.InnerHTML: web/src/shared に書くと lint が止める",
    path: "web/src/shared/Probe146.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const raw = <Message>(h: HtmlBuilder<Message>) => h.div([h.InnerHTML("<b>x</b>")], []);',
    expectedRules: ["foldkit(no-empty-children-array)", "taimei(no-inner-html-in-web)"],
  },
  {
    name: "web/non-production に h.InnerHTML: web/non-production に書くと lint が止める",
    path: "web/non-production/Probe147.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const raw = <Message>(h: HtmlBuilder<Message>) => h.div([h.InnerHTML("<b>x</b>")], []);',
    expectedRules: ["foldkit(no-empty-children-array)", "taimei(no-inner-html-in-web)"],
  },
  {
    name: "本番以外の shell の Foldkit の file は module の階層に let を置けない",
    path: "web/non-production/ModuleLetProbe.ts",
    source: 'import { Command } from "foldkit";\nexport let counter = 0;\nexport { Command };',
    expectedRules: ["foldkit(no-module-level-mutable-state)"],
  },
  {
    name: "本番以外の shell は shared/ui の部品を使い、h.button を直に書けない",
    path: "web/non-production/RawButtonProbe.ts",
    source:
      "type Builder = { readonly button: (attributes: unknown[], children: unknown[]) => unknown };\nexport const view = (h: Builder) => h.button([], []);",
    expectedRules: ["taimei(no-raw-form-element)"],
  },
  {
    name: "Foldkit の file は Math.random を使えない",
    path: "web/src/mfa/RandomProbe.ts",
    source:
      'import { Command } from "foldkit";\nexport const pick = () => [Math.random(), Command];',
    expectedRules: [
      "foldkit(no-impure-call-at-decision-time)",
      "taimei(no-timer-clock-random-in-foldkit)",
    ],
  },
  {
    name: "web の画面は Effect を実行せずに組み立てられる",
    path: "web/src/mfa/EffectBuildProbe.ts",
    source: 'import { Effect } from "effect";\nexport const run = () => Effect.void;',
    expectedRules: [],
  },
  {
    name: "Foldkit の file は時刻も乱数も使わずに書ける",
    path: "web/src/mfa/PureProbe.ts",
    source: 'import { Command } from "foldkit";\nexport const now = () => [0, Command];',
    expectedRules: [],
  },
  {
    name: "Foldkit の file は *-atom 以外の module を import できる",
    path: "web/src/mfa/PlainImportProbe.ts",
    source:
      'import { Command } from "foldkit";\nimport { mfaStatus } from "./mfa-status";\nexport { Command, mfaStatus };',
    expectedRules: [],
  },
  {
    name: "画面は h.input を直に書けない",
    path: "web/src/mfa/RawInputProbe.ts",
    source:
      "type Builder = { readonly input: (attributes: unknown[]) => unknown };\nexport const view = (h: Builder) => h.input([]);",
    expectedRules: ["taimei(no-raw-form-element)"],
  },
  {
    name: "画面は h.textarea を直に書けない",
    path: "web/src/mfa/RawTextareaProbe.ts",
    source:
      "type Builder = { readonly textarea: (attributes: unknown[], children: unknown[]) => unknown };\nexport const view = (h: Builder) => h.textarea([], []);",
    expectedRules: ["taimei(no-raw-form-element)"],
  },
  {
    name: "画面は h.select を直に書けない",
    path: "web/src/mfa/RawSelectProbe.ts",
    source:
      "type Builder = { readonly select: (attributes: unknown[], children: unknown[]) => unknown };\nexport const view = (h: Builder) => h.select([], []);",
    expectedRules: ["taimei(no-raw-form-element)"],
  },
  {
    name: "domain の file は Runtime.makeApplication を呼べない",
    path: "web/src/mfa/MakeApplicationProbe.ts",
    source:
      'import { Runtime } from "foldkit";\nexport const make = (config: Parameters<typeof Runtime.makeApplication>[0]) => Runtime.makeApplication(config);',
    expectedRules: ["taimei(no-direct-application-start)"],
  },
  {
    name: "domain の file は application を起動する関数を呼ばずに書ける",
    path: "web/src/mfa/NoStartProbe.ts",
    source: 'import { Command } from "foldkit";\nexport { Command };',
    expectedRules: [],
  },
  {
    name: "web は相対 import で書ける",
    path: "web/src/shared/RelativeImportProbe.ts",
    source: 'import { cn } from "./utils";\nexport { cn };',
    expectedRules: [],
  },
  {
    name: "route は app/*/route.ts の外で foldkit の Route を import できない",
    path: "web/src/mfa/RouteClassProbe.ts",
    source: 'import { Route } from "foldkit";\nexport { Route };',
    expectedRules: ["eslint(no-restricted-imports)"],
  },
  {
    name: "app/*/route.ts も sonner は import できない",
    path: "web/src/app/account/route.ts",
    source:
      'import { literal } from "foldkit/route";\nimport { toast } from "sonner";\nexport { literal, toast };',
    expectedRules: ["eslint(no-restricted-imports)"],
  },
  {
    name: "Foldkit の file は sonner を import できない",
    path: "web/src/mfa/SonnerProbe.ts",
    source:
      'import { Command } from "foldkit";\nimport { toast } from "sonner";\nexport { Command, toast };',
    expectedRules: ["eslint(no-restricted-imports)"],
  },
  {
    name: "web の if は braces を付ければ書ける",
    path: "web/src/shared/IfWithBracesProbe.ts",
    source:
      "export const sign = (value: number) => {\n  if (value > 0) {\n    return 1;\n  }\n  return -1;\n};",
    expectedRules: [],
  },
  {
    name: "web の test は型の cast を書ける",
    path: "web/src/shared/__tests__/CastProbe.ts",
    source: "export const asText = (value: unknown) => value as string;",
    expectedRules: [],
  },
  {
    name: "Foldkit の file は module の階層に const を置ける",
    path: "web/src/mfa/ModuleConstProbe.ts",
    source: 'import { Command } from "foldkit";\nexport const counter = 0;\nexport { Command };',
    expectedRules: [],
  },
  {
    name: "web の test の file でも、Message の _tag で switch できない",
    path: "web/src/mfa/__tests__/SwitchProbe.test.ts",
    source:
      'type Message = { readonly _tag: "A" } | { readonly _tag: "B" };\nexport const probe = (message: Message) => {\n  switch (message._tag) {\n    case "A":\n      return 1;\n    case "B":\n      return 2;\n  }\n};',
    expectedRules: ["foldkit(no-switch-on-message-tag)"],
  },
  {
    name: "web の画面の file は Message の _tag で switch できない",
    path: "web/src/mfa/SwitchProbe.ts",
    source:
      'type Message = { readonly _tag: "A" } | { readonly _tag: "B" };\nexport const probe = (message: Message) => {\n  switch (message._tag) {\n    case "A":\n      return 1;\n    case "B":\n      return 2;\n  }\n};',
    expectedRules: ["foldkit(no-switch-on-message-tag)", "taimei(no-tag-comparison-in-web)"],
  },
  {
    name: "web の画面は Effect.die で期待される失敗を欠陥にできない",
    path: "web/src/company/DieProbe.ts",
    source: 'import { Effect } from "effect";\nexport const fail = () => Effect.die("x");',
    expectedRules: ["taimei(no-effect-die-in-web)"],
  },
  {
    name: "web の画面は Effect.orDie で期待される失敗を欠陥にできない",
    path: "web/src/membership/OrDieProbe.ts",
    source:
      'import { Effect } from "effect";\nexport const fail = (effect: Effect.Effect<number, string>) => effect.pipe(Effect.orDie);',
    expectedRules: ["taimei(no-effect-die-in-web)"],
  },
  {
    name: "本番以外の shell も Effect.orDie で失敗を欠陥にできない",
    path: "web/non-production/OrDieProbe.ts",
    source:
      'import { Effect } from "effect";\nexport const fail = (effect: Effect.Effect<number, string>) => Effect.orDie(effect);',
    expectedRules: ["taimei(no-effect-die-in-web)"],
  },
  {
    name: "web の test は Effect.die を使える",
    path: "web/src/company/__tests__/DieProbe.ts",
    source: 'import { Effect } from "effect";\nexport const fail = () => Effect.die("x");',
    expectedRules: [],
  },
  {
    name: "web の画面は失敗を型付きの失敗として返せる",
    path: "web/src/company/FailProbe.ts",
    source: 'import { Effect } from "effect";\nexport const fail = () => Effect.fail("x");',
    expectedRules: [],
  },
  {
    name: "web に page を作る独自の関数を書けない",
    path: "web/src/company/DefinePageProbe.ts",
    source: "export const definePage = <Model>(model: Model) => model;",
    expectedRules: ["taimei(no-hand-rolled-page-builders)"],
  },
  {
    name: "web に application を起動する独自の関数を書けない",
    path: "web/non-production/StartRoutingProbe.ts",
    source: "export const startRoutingApplication = () => 1;",
    expectedRules: ["taimei(no-hand-rolled-page-builders)"],
  },
  {
    name: "web で表示中の印の aria-current を AriaCurrent で手書きできない",
    path: "web/src/shared/AriaCurrentProbe.ts",
    source:
      'export const mark = (h: { AriaCurrent: (value: string) => unknown }) => h.AriaCurrent("page");',
    expectedRules: ["taimei(no-hand-written-current-marker)"],
  },
  {
    name: "web で表示中の印の data-status を手書きできない",
    path: "web/src/shared/DataStatusProbe.ts",
    source: 'export const mark = { "data-status": "active" };',
    expectedRules: ["taimei(no-hand-written-current-marker)"],
  },
  {
    name: 'web で表示中の印を DataAttribute("status") で手書きできない',
    path: "web/src/shared/DataAttributeProbe.ts",
    source:
      'export const mark = (h: { DataAttribute: (name: string, value: string) => unknown }) => h.DataAttribute("status", "active");',
    expectedRules: ["taimei(no-hand-written-current-marker)"],
  },
  {
    name: "web の link は aria-current 以外の DataAttribute を書ける",
    path: "web/src/shared/OtherDataAttributeProbe.ts",
    source:
      'export const mark = (h: { DataAttribute: (name: string, value: string) => unknown }) => h.DataAttribute("kind", "nav");',
    expectedRules: [],
  },
  {
    name: "MFA の失敗の文言を mfa-failure-messages.ts の外に書けない",
    path: "web/src/company/MfaTextProbe.ts",
    source: 'export const text = "入力されたコードが正しくありません。";',
    expectedRules: ["taimei(mfa-failure-text-only-in-mfa-failure-messages)"],
  },
  {
    name: "MFA の失敗の文言は mfa-failure-messages.ts に書ける",
    path: "web/src/mfa/mfa-failure-messages.ts",
    source: 'export const text = "入力されたコードが正しくありません。";',
    expectedRules: [],
  },
  {
    name: "MFA の失敗の文言を template の中にも書けない",
    path: "web/src/mfa/MfaTemplateProbe.ts",
    source: "export const text = (name: string) => `$" + "{name}はすでに有効です。`;",
    expectedRules: ["taimei(mfa-failure-text-only-in-mfa-failure-messages)"],
  },
  {
    name: "web に redirect の許可の検査を import できない",
    path: "web/src/auth/AllowlistImportProbe.ts",
    source:
      'import { isAllowedRedirect } from "@core/url-allowlist";\nexport { isAllowedRedirect };',
    expectedRules: ["taimei(redirect-allowlist-not-in-web)"],
  },
  {
    name: "web に validateRedirectUrl を書けない",
    path: "web/src/auth/ValidateRedirectProbe.ts",
    source: "export const validateRedirectUrl = (url: string) => url;",
    expectedRules: ["taimei(redirect-allowlist-not-in-web)"],
  },
  {
    name: "web は redirect の許可の検査と関係のない module を import できる",
    path: "web/src/auth/PlainAuthProbe.ts",
    source:
      'import { signInParamsSchema } from "@core/sign-in-params";\nexport { signInParamsSchema };',
    expectedRules: [],
  },
  {
    name: "e2e の spec に test.fixme を書けない",
    path: "e2e/FixmeProbe.e2e.ts",
    source: 'import { test } from "@playwright/test";\ntest.fixme("x", async () => {});',
    expectedRules: ["taimei(no-fixme-in-e2e)"],
  },
  {
    name: "e2e の spec は test を書ける",
    path: "e2e/PlainProbe.e2e.ts",
    source: 'import { test } from "@playwright/test";\ntest("x", async () => {});',
    expectedRules: [],
  },
  {
    name: "application の選択は build の環境の値を読めない",
    path: "web/src/app/runtime-for-path.ts",
    source: "export const isDev = import.meta.env.VITE_FLAG;",
    expectedRules: ["taimei(no-build-env-in-runtime-selection)"],
  },
  {
    name: "起動の入口 main.ts も build の環境の値を読めない",
    path: "web/src/main.ts",
    source: "export const mode = import.meta.env.PROD;",
    expectedRules: ["taimei(no-build-env-in-runtime-selection)", "taimei(no-build-mode-in-web)"],
  },
  {
    name: "runtime の選択の外の file は import.meta.env の設定値を読める",
    path: "web/src/shared/EnvValueProbe.ts",
    source: "export const token = import.meta.env.VITE_CANARY_TOKEN_ID;",
    expectedRules: [],
  },
  {
    name: "page は leave-spa を import して、document を離れる遷移を自分で起こせない",
    path: "web/src/membership/LeaveSpaImportProbe.ts",
    source: 'import { leaveSpaToSignIn } from "../shared/leave-spa";\nexport { leaveSpaToSignIn };',
    expectedRules: ["taimei(leave-spa-import-only-in-app)"],
  },
  {
    name: "application は leave-spa を import して、document を離れる遷移を起こせる",
    path: "web/src/app/LeaveSpaImportProbe.ts",
    source: 'import { leaveSpaToSignIn } from "../shared/leave-spa";\nexport { leaveSpaToSignIn };',
    expectedRules: [],
  },
  {
    name: "src が drizzle-orm の subpath を import すると、lint が止める",
    path: "src/company/DrizzleProbe.ts",
    source: 'import { sql } from "drizzle-orm/sql";\nexport const s = sql;',
    expectedRules: ["taimei(db-import-only-in-db)"],
  },
  {
    name: "src が pg を import すると、lint が止める",
    path: "src/handlers/PgProbe.ts",
    source: 'import { Pool } from "pg";\nexport const p = Pool;',
    expectedRules: ["taimei(db-import-only-in-db)"],
  },
  {
    name: "src が @core/ から db/client を import すると、lint が止める",
    path: "src/company/CoreProbe.ts",
    source: 'import { db } from "@core/../db/client";\nexport const d = db;',
    expectedRules: ["taimei(db-import-only-in-db)"],
  },
  {
    name: "src の test が相対 path で db/client を import すると、lint が止める",
    path: "src/__tests__/DbProbe.ts",
    source: 'import { db } from "../../db/client";\nexport const d = db;',
    expectedRules: [
      "taimei(db-import-in-src-tests-only-in-test-db)",
      "taimei(db-value-import-only-in-db-in-tests)",
    ],
  },
  {
    name: "testing が相対 path で db/client を import すると、lint が止める",
    path: "testing/DbProbe.ts",
    source: 'import { db } from "../db/client";\nexport const d = db;',
    expectedRules: ["taimei(db-import-only-in-db)"],
  },
  {
    name: "testing の test が drizzle-orm を import すると、lint が止める",
    path: "testing/__tests__/DrizzleProbe.ts",
    source: 'import { drizzle } from "drizzle-orm/node-postgres";\nexport const d = drizzle;',
    expectedRules: ["taimei(db-value-import-only-in-db-in-tests)"],
  },
  {
    name: "web が相対 path で db/client を import すると、lint が止める",
    path: "web/src/company/DbProbe.ts",
    source: 'import { db } from "../../../db/client";\nexport const d = db;',
    expectedRules: ["taimei(db-import-only-in-db)"],
  },
  {
    name: "SDK が相対 path で db/schema を import すると、lint が止める",
    path: "packages/auth-client/src/DbProbe.ts",
    source: 'import * as schema from "../../../db/schema";\nexport const s = schema;',
    expectedRules: ["taimei(db-import-only-in-db)"],
  },
  {
    name: "infra が pg を import すると、lint が止める",
    path: "infra/PgProbe.ts",
    source: 'import { Pool } from "pg";\nexport const p = Pool;',
    expectedRules: ["taimei(db-import-only-in-db)"],
  },
  {
    name: "e2e が相対 path で db/client を import すると、lint が止める",
    path: "e2e/DbProbe.ts",
    source: 'import { db } from "../db/client";\nexport const d = db;',
    expectedRules: ["taimei(db-import-in-e2e-only-db-testing)", "taimei(db-import-only-in-db)"],
  },
  {
    name: "db/client.ts の外の db の file が pg を import すると、lint が止める",
    path: "db/repositories/PgProbe.ts",
    source: 'import { Pool } from "pg";\nexport const p = Pool;',
    expectedRules: ["taimei(pg-import-only-in-db-client)"],
  },
  {
    name: "db/client.ts は pg を import できる",
    path: "db/client.ts",
    source: 'import { Pool } from "pg";\nexport const p = Pool;',
    expectedRules: [],
  },
  {
    name: "src/worker.ts は directive 無しで db/client を import できる",
    path: "src/worker.ts",
    source:
      'import { runWithRequestPool } from "@/db/client";\nexport const pooled = runWithRequestPool;',
    expectedRules: [],
  },
  {
    name: "test-db.ts は db/testing を import できる",
    path: "src/__tests__/test-db.ts",
    source: 'import * as seed from "@/db/testing/seed";\nexport const s = seed;',
    expectedRules: [],
  },
  {
    name: "testing は db/testing を import できる",
    path: "testing/SeedProbe.ts",
    source: 'import * as seed from "../db/testing/seed";\nexport const s = seed;',
    expectedRules: [],
  },
  {
    name: "testing の test は db/testing を import できる",
    path: "testing/__tests__/SeedProbe.ts",
    source: 'import * as seed from "../../db/testing/seed";\nexport const s = seed;',
    expectedRules: [],
  },
  {
    name: "src は db/repositories を型で import できる",
    path: "src/company/TypeProbe.ts",
    source:
      'import type { CompanyRow } from "../../db/repositories/company";\nexport type C = CompanyRow;',
    expectedRules: [],
  },
  {
    name: "src は db/enums を import できる",
    path: "src/company/EnumProbe.ts",
    source: 'import { ROLES } from "../../db/enums";\nexport const r = ROLES;',
    expectedRules: [],
  },
  {
    name: "status を書かずに Schema.TaggedError を宣言すると、lint が止める",
    path: "src/company/FailureProbe.ts",
    source:
      'import { Schema } from "effect";\nexport class Probe extends Schema.TaggedError<Probe>()("Probe", {}) {}',
    expectedRules: ["taimei(tagged-error-only-in-failure)"],
  },
  {
    name: "src/errors.ts の外で EmailError を new すると、lint が止める",
    path: "src/email/BoundaryProbe.ts",
    source:
      'import { EmailError } from "../errors";\nexport const failed = new EmailError({ cause: 1 });',
    expectedRules: ["taimei(boundary-error-construction-only-in-errors)"],
  },
  {
    name: "src/errors.ts の外で DbError を new すると、lint が止める",
    path: "src/company/BoundaryProbe.ts",
    source:
      'import { DbError } from "../errors";\nexport const failed = new DbError({ cause: 1 });',
    expectedRules: ["taimei(boundary-error-construction-only-in-errors)"],
  },
  {
    name: "src/errors.ts は境界の失敗を new できる",
    path: "src/errors.ts",
    source:
      "class DbError {\n  constructor(readonly fields: { readonly cause: unknown }) {}\n}\nexport const failed = new DbError({ cause: 1 });",
    expectedRules: [],
  },
  {
    name: "一覧に無い file が runPromise を呼ぶと、lint が止める",
    path: "src/company/RunProbe.ts",
    source:
      "export const run = (runtime: { runPromise: (effect: unknown) => unknown }, effect: unknown) => runtime.runPromise(effect);",
    expectedRules: ["taimei(effect-run-only-in-listed-files)"],
  },
  {
    name: "Date.now() を呼ぶと、lint が止める",
    path: "src/company/ClockProbe.ts",
    source: "export const now = () => Date.now();",
    expectedRules: ["taimei(clock-and-id-only-in-services)"],
  },
  {
    name: "crypto.randomUUID() を呼ぶと、lint が止める",
    path: "src/company/IdProbe.ts",
    source: "export const id = () => crypto.randomUUID();",
    expectedRules: ["taimei(clock-and-id-only-in-services)"],
  },
  {
    name: "entry の外が TTL store の driver を import すると、lint が止める",
    path: "src/company/DriverProbe.ts",
    source: 'import * as driver from "../kv-store.memory";\nexport const d = driver;',
    expectedRules: ["taimei(ttl-store-driver-import-only-in-entry-files)"],
  },
  {
    name: "email の外が send-* を import すると、lint が止める",
    path: "src/company/EmailProbe.ts",
    source: 'import * as welcome from "../email/send-welcome";\nexport const w = welcome;',
    expectedRules: ["taimei(email-send-only-in-email-wiring)"],
  },
  {
    name: "background.ts の外が Effect.forkDetach を書くと、lint が止める",
    path: "src/company/ForkProbe.ts",
    source:
      'import { Effect } from "effect";\nexport const forked = Effect.forkDetach(Effect.void);',
    expectedRules: ["taimei(run-background-only-in-background)"],
  },
  {
    name: "run-rpc.ts の外が ConnectError を書くと、lint が止める",
    path: "src/rpc/ConnectProbe.ts",
    source:
      'import { Code, ConnectError } from "@connectrpc/connect";\nexport const failed = new ConnectError("x", Code.Internal);',
    expectedRules: ["taimei(connect-error-only-in-run-rpc)"],
  },
  {
    name: "HttpApiSchema.WithHeaders を書くと、lint が止める",
    path: "src/handlers/HeadersProbe.ts",
    source:
      "declare const HttpApiSchema: { readonly WithHeaders: unknown };\nexport const headers = HttpApiSchema.WithHeaders;",
    expectedRules: ["taimei(no-with-headers-in-http-api)"],
  },
  {
    name: "Transport が policy を import すると、lint が止める",
    path: "src/handlers/PolicyProbe.ts",
    source: 'import * as policy from "../membership/policy";\nexport const p = policy;',
    expectedRules: ["taimei(no-policy-or-transaction-in-transport)"],
  },
  {
    name: "Transport が transaction を import すると、lint が止める",
    path: "src/rpc/TxProbe.ts",
    source: 'import * as transaction from "../transaction";\nexport const t = transaction;',
    expectedRules: ["taimei(no-policy-or-transaction-in-transport)"],
  },
  {
    name: "一覧に無い Transport の file が port を import すると、lint が止める",
    path: "src/rpc/PortProbe.ts",
    source: 'import * as ports from "../company/ports";\nexport const p = ports;',
    expectedRules: ["taimei(port-import-only-in-reading-transport)"],
  },
  {
    name: "Guard が hono/cookie を import すると、lint が止める",
    path: "src/membership/guard/HonoProbe.ts",
    source: 'import { getCookie } from "hono/cookie";\nexport const g = getCookie;',
    expectedRules: ["taimei(no-hono-in-guard)"],
  },
  {
    name: "契約の外の file が /api/company の path を書くと、lint が止める",
    path: "src/company/PathProbe.ts",
    source: 'export const path = "/api/company/settings";',
    expectedRules: ["taimei(spa-api-path-only-in-contract)"],
  },
  {
    name: "services/ に file を置くと、lint が止める",
    path: "src/company/services/Probe.ts",
    source: "export const x = 1;",
    expectedRules: ["taimei(no-services-or-utils-dir)"],
  },
  {
    name: "utils/ に file を置くと、lint が止める",
    path: "src/utils/Probe.ts",
    source: "export const x = 1;",
    expectedRules: ["taimei(no-services-or-utils-dir)"],
  },
  {
    name: "adapter は runPromise を呼べる",
    path: "src/handlers/run-route.ts",
    source:
      "export const run = (runtime: { runPromise: (effect: unknown) => unknown }, effect: unknown) => runtime.runPromise(effect);",
    expectedRules: [],
  },
  {
    name: "background.ts は Effect.forkDetach を書ける",
    path: "src/background.ts",
    source:
      'import { Effect } from "effect";\nexport const forked = Effect.forkDetach(Effect.void);',
    expectedRules: [],
  },
  {
    name: "run-rpc.ts は ConnectError を書ける",
    path: "src/rpc/run-rpc.ts",
    source:
      'import { Code, ConnectError } from "@connectrpc/connect";\nexport const failed = new ConnectError("x", Code.Internal);',
    expectedRules: [],
  },
  {
    name: "boot.ts は TTL store の driver を import できる",
    path: "src/boot.ts",
    source: 'import * as driver from "./kv-store.memory";\nexport const d = driver;',
    expectedRules: [],
  },
  {
    name: "/api/auth の path は書ける",
    path: "src/company/AuthPathProbe.ts",
    source: 'export const path = "/api/auth/sign-out";',
    expectedRules: [],
  },
  {
    name: "spec が ./fixtures を import すると、lint が止める",
    path: "e2e/FixturesProbe.e2e.ts",
    source: 'import * as fixtures from "./fixtures";\nexport const f = fixtures;',
    expectedRules: ["taimei(fixtures-import-only-in-seed)"],
  },
  {
    name: "spec が page.route を呼ぶと、lint が止める",
    path: "e2e/RouteProbe.e2e.ts",
    source:
      'export const mock = (page: { route: (url: string, handler: () => void) => unknown }) => page.route("**/x", () => {});',
    expectedRules: ["taimei(page-route-only-in-contract-mock)"],
  },
  {
    name: "spec が .server.log を書くと、lint が止める",
    path: "e2e/LogProbe.e2e.ts",
    source: 'export const log = "e2e/.server.log";',
    expectedRules: ["taimei(server-log-only-in-helpers)"],
  },
  {
    name: "spec が /login-links を書くと、lint が止める",
    path: "e2e/LoginProbe.e2e.ts",
    source: 'export const path = "/testing/v1/login-links";',
    expectedRules: ["taimei(login-links-only-in-helpers)"],
  },
  {
    name: "spec が _tag を key に書くと、lint が止める",
    path: "e2e/TagProbe.e2e.ts",
    source: 'export const body = { _tag: "LastOwner" };',
    expectedRules: ["taimei(declared-failure-only-in-contract-mock)"],
  },
  {
    name: "spec は ./fixture-names を import できる",
    path: "e2e/NamesProbe.e2e.ts",
    source: 'import * as names from "./fixture-names";\nexport const n = names;',
    expectedRules: [],
  },
  {
    name: "helpers.ts は .server.log と /login-links を書ける",
    path: "e2e/helpers.ts",
    source: 'export const log = "e2e/.server.log";\nexport const path = "/testing/v1/login-links";',
    expectedRules: [],
  },
  {
    name: "contract-mock.ts は page.route と _tag を書ける",
    path: "e2e/contract-mock.ts",
    source:
      'export const mock = (page: { route: (url: string, handler: () => void) => unknown }) => page.route("**/x", () => {});\nexport const body = { _tag: "LastOwner" };',
    expectedRules: [],
  },
  {
    name: "page が shared/leave-spa を import すると、lint が止める",
    path: "web/src/account/pages/LeaveProbe.ts",
    source:
      'import { leaveSpaTo } from "../../shared/leave-spa";\nexport const leave = leaveSpaTo;',
    expectedRules: ["taimei(leave-spa-import-only-in-app)"],
  },
  {
    name: "application の file は shared/leave-spa を import できる",
    path: "web/src/app/account/LeaveProbe.ts",
    source:
      'import { leaveSpaTo } from "../../shared/leave-spa";\nexport const leave = leaveSpaTo;',
    expectedRules: [],
  },
  {
    name: "FailureMessages 型の表を export すると、lint が止める",
    path: "web/src/company/TableProbe.ts",
    source:
      'import type { FailureMessages } from "../shared/failure-message";\nexport const MESSAGES: FailureMessages<{ readonly _tag: "A" }> = { A: "a", Unexpected: "u" };\nexport const text = MESSAGES.A;',
    expectedRules: ["taimei(failure-messages-not-exported)"],
  },
  {
    name: "export しない表は書ける",
    path: "web/src/company/LocalTableProbe.ts",
    source:
      'import type { FailureMessages } from "../shared/failure-message";\nconst MESSAGES: FailureMessages<{ readonly _tag: "A" }> = { A: "a", Unexpected: "u" };\nexport const text = MESSAGES.A;',
    expectedRules: [],
  },
  {
    name: "mfa の外が MFA の表を import すると、lint が止める",
    path: "web/src/account/MfaTableProbe.ts",
    source:
      'import { mfaFailureText } from "../mfa/mfa-failure-messages";\nexport const text = mfaFailureText;',
    expectedRules: ["taimei(mfa-failure-messages-import-only-in-mfa)"],
  },
  {
    name: "パスキーの文言の表は、登録の前の MFA のコードの失敗に同じ文言を出すために MFA の表を import できる",
    path: "web/src/passkey/passkey-failure-messages.ts",
    source:
      'import { mfaFailureText } from "../mfa/mfa-failure-messages";\nexport const text = mfaFailureText;',
    expectedRules: [],
  },
  {
    name: "mfa の file は MFA の表を import できる",
    path: "web/src/mfa/MfaTableProbe.ts",
    source:
      'import { mfaFailureText } from "./mfa-failure-messages";\nexport const text = mfaFailureText;',
    expectedRules: [],
  },
  {
    name: "SDK が effect を import すると、lint が止める",
    path: "packages/auth-client/src/EffectProbe.ts",
    source: 'import { Option } from "effect";\nexport const o = Option;',
    expectedRules: ["taimei(sdk-import-only-peer-dependencies)"],
  },
  {
    name: "SDK が hono を型で import すると、lint が止める",
    path: "packages/auth-client/src/HonoProbe.ts",
    source: 'import type { Context } from "hono";\nexport type C = Context;',
    expectedRules: ["taimei(sdk-import-only-peer-dependencies)"],
  },
  {
    name: "SDK が next/link を import すると、lint が止める",
    path: "packages/auth-client/src/NextProbe.ts",
    source: 'import Link from "next/link";\nexport const l = Link;',
    expectedRules: ["taimei(sdk-import-only-peer-dependencies)"],
  },
  {
    name: "SDK が node:buffer を import すると、lint が止める",
    path: "packages/auth-client/src/NodeProbe.ts",
    source: 'import { Buffer } from "node:buffer";\nexport const b = Buffer;',
    expectedRules: ["taimei(sdk-import-only-peer-dependencies)"],
  },
  {
    name: "SDK は peerDependencies の package を import できる",
    path: "packages/auth-client/src/ConnectProbe.ts",
    source: 'import { Code } from "@connectrpc/connect";\nexport const c = Code;',
    expectedRules: [],
  },
  {
    name: "SDK は peerDependencies の package の subpath を import できる",
    path: "packages/auth-client/src/ProtobufProbe.ts",
    source: 'import { fileDesc } from "@bufbuild/protobuf/codegenv2";\nexport const f = fileDesc;',
    expectedRules: [],
  },
  {
    name: "SDK は相対 path を import できる",
    path: "packages/auth-client/src/RelativeProbe.ts",
    source: 'import * as types from "./types";\nexport const t = types;',
    expectedRules: [],
  },
  {
    name: "scripts は依存を install する前に走るので、package を型でも import できない",
    path: "scripts/PackageTypeImport.ts",
    source: 'import type { Effect } from "effect";\nexport type Used = Effect.Effect<1>;',
    expectedRules: ["taimei(scripts-import-only-node-builtins)"],
  },
  {
    name: "scripts は依存を install する前に走るので、package を再 export できない",
    path: "scripts/PackageReExport.ts",
    source: 'export { Effect } from "effect";',
    expectedRules: ["taimei(scripts-import-only-node-builtins)"],
  },
  {
    name: "scripts は依存を install する前に走るので、相対 path の file を import できない",
    path: "scripts/RelativeImport.ts",
    source: 'import { sibling } from "./sibling";\nexport const used = sibling;',
    expectedRules: ["taimei(scripts-import-only-node-builtins)"],
  },
  {
    name: "server のメールは react-dom を import できない",
    path: "src/email/ReactDomImport.ts",
    source:
      'import { renderToString } from "react-dom/server";\nexport const render = renderToString;',
    expectedRules: ["taimei(no-react-outside-web)"],
  },
  {
    name: "server は react を型でも import できない",
    path: "src/handlers/ReactTypeImport.ts",
    source: 'import type { ReactNode } from "react";\nexport type Node = ReactNode;',
    expectedRules: ["taimei(no-react-outside-web)"],
  },
  {
    name: "server のメールは @react-email の package を import できない",
    path: "src/email/ReactEmailImport.ts",
    source: 'import { Html } from "@react-email/components";\nexport const html = Html;',
    expectedRules: ["taimei(no-react-outside-web)"],
  },
  {
    name: "src の test も react を import できない",
    path: "src/__tests__/ReactImport.ts",
    source: 'import "react";',
    expectedRules: ["taimei(no-react-outside-web)"],
  },
  {
    name: "本番以外の entry も react を import できない",
    path: "testing/ReactImport.ts",
    source: 'import "react";',
    expectedRules: ["taimei(no-react-outside-web)"],
  },
  {
    name: "e2e も react を import できない",
    path: "e2e/ReactImport.ts",
    source: 'import "react";',
    expectedRules: ["taimei(no-react-outside-web)"],
  },
  {
    name: "db も react を import できない",
    path: "db/ReactImport.ts",
    source: 'import "react";',
    expectedRules: ["taimei(no-react-outside-web)"],
  },
  {
    name: "management も react を import できない",
    path: "management/ReactImport.ts",
    source: 'import "react";',
    expectedRules: ["taimei(no-react-outside-web)"],
  },
  {
    name: "react の名前で始まるだけの package は、react として止めない",
    path: "src/email/ReactIsImport.ts",
    source: 'import "react-is";',
    expectedRules: [],
  },
  {
    name: "e2e は process.cwd() から path を組めない",
    path: "e2e/CwdProbe.ts",
    source: 'import { join } from "node:path";\nexport const root = join(process.cwd(), "e2e");',
    expectedRules: ["taimei(no-process-cwd-in-e2e)"],
  },
  {
    name: "playwright.config.ts は process.cwd() を呼べない",
    path: "playwright.config.ts",
    source: "export const root = process.cwd();",
    expectedRules: ["taimei(no-process-cwd-in-e2e)"],
  },
  {
    name: "e2e は実行する dir に依らない import.meta.dirname から path を組める",
    path: "e2e/DirnameProbe.ts",
    source: "export const root = import.meta.dirname;",
    expectedRules: [],
  },
  {
    name: "e2e の外では process.cwd() を呼べる",
    path: "scripts/CwdProbe.ts",
    source: "export const root = process.cwd();",
    expectedRules: [],
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
    name: "型を使う lint: web/src でも Promise を待たずに捨てられない (no-floating-promises)",
    path: "web/src/type-aware/NoFloatingPromises.ts",
    source: "export const probe = () => {\n  Promise.resolve(1);\n};",
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
  writeFileSync(
    join(fixtureDir, "packages/auth-client/package.json"),
    readFileSync(join(REPO_ROOT, "packages/auth-client/package.json"), "utf8"),
  );
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
    rulesByCase.set(
      testCase,
      [
        ...new Set(
          diagnostics.filter(({ filename }) => filename === testCase.path).map(({ code }) => code),
        ),
      ].toSorted(),
    );
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
    expect(rulesByCase.get(testCase)).toEqual([...testCase.expectedRules].toSorted());
  });

  test("fixture の file はすべて oxlint に読まれるので、指摘の無い case は読み飛ばしで通らない", () => {
    expect(lintedFileCounts.map(({ linted }) => linted)).toEqual(
      lintedFileCounts.map(({ written }) => written),
    );
  });
});

type PackageScripts = { readonly scripts: Readonly<Record<string, string>> };

type OxlintRuleInfo = {
  readonly value: string;
  readonly category: string;
  readonly type_aware: boolean;
};

type RuleSetting = string | number | readonly unknown[];

type OxlintConfig = {
  readonly categories?: Readonly<Record<string, string>>;
  readonly rules?: Readonly<Record<string, RuleSetting>>;
  readonly overrides?: ReadonlyArray<{ readonly rules?: Readonly<Record<string, RuleSetting>> }>;
};

const ruleNameOf = (key: string) => key.split("/").at(-1) ?? key;

const isOff = (setting: RuleSetting) => {
  const level = Array.isArray(setting) ? setting[0] : setting;
  return level === "off" || level === 0 || level === "allow";
};

const oxlintRuleInfos = (): OxlintRuleInfo[] =>
  JSON.parse(spawnSync(OXLINT, ["--rules", "--format", "json"], { encoding: "utf8" }).stdout);

const typeAwareRuleNames = () =>
  new Set(
    oxlintRuleInfos()
      .filter((rule) => rule.type_aware)
      .map((rule) => rule.value),
  );

const enabledTypeAwareRuleNames = (): string[] => {
  const config: OxlintConfig = JSON.parse(readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8"));
  const typeAwareRules = oxlintRuleInfos().filter((rule) => rule.type_aware);
  const topLevel = config.rules ?? {};
  const offAtTopLevel = new Set(
    Object.entries(topLevel)
      .filter(([, setting]) => isOff(setting))
      .map(([key]) => ruleNameOf(key)),
  );
  const byCategory = typeAwareRules
    .filter(
      (rule) =>
        config.categories?.[rule.category] !== undefined &&
        config.categories[rule.category] !== "off" &&
        !offAtTopLevel.has(rule.value),
    )
    .map((rule) => rule.value);
  const typeAware = new Set(typeAwareRules.map((rule) => rule.value));
  const explicit = [topLevel, ...(config.overrides ?? []).map((override) => override.rules ?? {})]
    .flatMap((settings) => Object.entries(settings))
    .filter(([key, setting]) => typeAware.has(ruleNameOf(key)) && !isOff(setting))
    .map(([key]) => ruleNameOf(key));
  return [...new Set([...byCategory, ...explicit])].toSorted();
};

describe("型を使う lint は、CI の lint で走り、有効な rule ごとに fixture を持つ", () => {
  test("package.json の lint は、oxlint に --type-aware を渡す", () => {
    const { scripts }: PackageScripts = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    );
    const oxlintArguments = (scripts.lint ?? "").split("&&")[0]?.trim().split(/\s+/) ?? [];
    expect(oxlintArguments[0]).toBe("oxlint");
    expect(oxlintArguments).toContain("--type-aware");
  });

  test("有効にした型を使う rule は、どれもこの file の fixture に名前がある", () => {
    const enabled = enabledTypeAwareRuleNames();
    expect(enabled.length).toBeGreaterThan(0);
    const fixtures = readFileSync(import.meta.path, "utf8");
    expect(enabled.filter((rule) => !fixtures.includes(`typescript(${rule})`))).toEqual([]);
  });

  test("型を使う rule を止める oxlint-disable の directive は、理由を書く", () => {
    const typeAware = typeAwareRuleNames();
    const directivePattern = /\/\/\s*oxlint-disable[^\n]*/g;
    const withoutReason = repoFiles(
      "src",
      "web",
      "db",
      "e2e",
      "testing",
      "management",
      "infra",
      "packages",
      "lint",
      "scripts",
    )
      .filter((file) => /\.(ts|tsx|mts)$/.test(file))
      .flatMap((file) =>
        (readFileSync(join(REPO_ROOT, file), "utf8").match(directivePattern) ?? [])
          .filter((directive) => {
            const [rules = ""] = directive.split(" -- ");
            return (
              !directive.includes(" -- ") &&
              rules.split(/[\s,]+/).some((token) => typeAware.has(ruleNameOf(token)))
            );
          })
          .map((directive) => `${file}: ${directive}`),
      );
    expect(withoutReason).toEqual([]);
  });
});
