import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Option } from "effect";
import { expect as expectScene, given as givenScene, role, scene } from "foldkit/scene";
import { fromString } from "foldkit/url";

import * as CurrentCompany from "../web/src/account/current-company";
import { init, Message, type Model, update, view } from "../web/src/app/account/main";
import * as MemberInvitations from "../web/src/invitation/member-invitations";
import * as Members from "../web/src/membership/pages/Members";

const REPO_ROOT = join(import.meta.dir, "..");

type Fixture = {
  readonly ac: string;
  readonly kind: "violation" | "allowed";
  readonly path: string;
  readonly source: string;
  readonly label: string;
};

type Diagnostic = { readonly code: string; readonly filename: string; readonly severity: string };

const run = (command: string, args: readonly string[], cwd = REPO_ROOT) =>
  spawnSync(command, [...args], { cwd, encoding: "utf8", timeout: 300_000 });

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] =>
  run("git", ["grep", "-n", "-F", "--untracked", pattern, "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "");

const gitFiles = (...pathspecs: string[]): string[] =>
  run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "");

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const configWithAbsolutePlugins = (): string => {
  const config: { jsPlugins?: Array<string | { name: string; specifier: string }> } = JSON.parse(
    read(".oxlintrc.json"),
  );
  const absolute = (specifier: string) =>
    specifier.startsWith(".") ? join(REPO_ROOT, specifier) : specifier;
  const jsPlugins = (config.jsPlugins ?? []).map((plugin) =>
    typeof plugin === "string" ? absolute(plugin) : { ...plugin, specifier: absolute(plugin.specifier) },
  );
  return JSON.stringify({ ...config, jsPlugins });
};

const STOPPING_CODE = /^(taimei\(|eslint\(no-restricted-)/;

const fixtureDirs: string[] = [];

const groupsWithDistinctPaths = (fixtures: readonly Fixture[]): Fixture[][] =>
  fixtures.reduce<Fixture[][]>((groups, fixture) => {
    const free = groups.find((group) => group.every(({ path }) => path !== fixture.path));
    if (free === undefined) {
      return [...groups, [fixture]];
    }
    free.push(fixture);
    return groups;
  }, []);

const stoppingCodesByFixture = new Map<Fixture, string[]>();

const lintGroup = (group: readonly Fixture[]): void => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "acceptance-lint-398-"));
  fixtureDirs.push(fixtureDir);
  writeFileSync(join(fixtureDir, ".oxlintrc.json"), configWithAbsolutePlugins());
  symlinkSync(join(REPO_ROOT, "node_modules"), join(fixtureDir, "node_modules"));
  for (const { path, source } of group) {
    mkdirSync(dirname(join(fixtureDir, path)), { recursive: true });
    writeFileSync(join(fixtureDir, path), `${source}\n`);
  }
  const result = run(
    join(REPO_ROOT, "node_modules/.bin/oxlint"),
    ["--disable-nested-config", "--format", "json", ...group.map(({ path }) => path)],
    fixtureDir,
  );
  const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  for (const fixture of group) {
    stoppingCodesByFixture.set(
      fixture,
      diagnostics
        .filter(
          ({ filename, code, severity }) =>
            filename === fixture.path && severity === "error" && STOPPING_CODE.test(code),
        )
        .map(({ code }) => code),
    );
  }
};

const MOVED_CHECK_FIXTURES: readonly Fixture[] = [
  { ac: "AC-001", kind: "violation", path: "web/src/company/zz-probe.ts", source: "export const load = () => fetch(\"/x\");", label: "fetch を書かない" },
  { ac: "AC-001", kind: "violation", path: "web/src/shared/zz-probe.ts", source: "import { SpaHttpClient } from \"./spa-http-client\"; export const c = SpaHttpClient;", label: "SpaHttpClient は Foldkit の file と application の entry だけ" },
  { ac: "AC-001", kind: "allowed", path: "web/src/shared/zz-probe.ts", source: "import { SpaHttpClient } from \"./spa-http-client\"; import { Command } from \"foldkit\"; export const c = [SpaHttpClient, Command];", label: "SpaHttpClient は Foldkit の file と application の entry だけ" },
  { ac: "AC-001", kind: "allowed", path: "web/src/app/zz/entry.ts", source: "import { SpaHttpClient } from \"../../shared/spa-http-client\"; export const c = SpaHttpClient;", label: "SpaHttpClient は Foldkit の file と application の entry だけ" },
  { ac: "AC-001", kind: "allowed", path: "web/src/company/zz-probe.ts", source: "import type { SpaHttpClient } from \"../shared/spa-http-client\"; export type C = SpaHttpClient;", label: "SpaHttpClient は Foldkit の file と application の entry だけ" },
  { ac: "AC-001", kind: "violation", path: "web/src/shared/zz-probe.ts", source: "import { HttpClient } from \"effect/http\"; export const c = HttpClient;", label: "effect/http の値の import は書かない" },
  { ac: "AC-001", kind: "allowed", path: "web/src/shared/zz-probe.ts", source: "import type { HttpClientError } from \"effect/http\"; export type E = HttpClientError.HttpClientError;", label: "effect/http の値の import は書かない" },
  { ac: "AC-001", kind: "violation", path: "web/src/account/zz-probe.ts", source: "export const f = (client: { listSessions(): void }) => client.listSessions();", label: "better-auth の一覧の読み出しは auth-client-read.ts だけ" },
  { ac: "AC-001", kind: "allowed", path: "web/src/account/auth-client-read.ts", source: "export const f = (client: { listSessions(): void }) => client.listSessions();", label: "better-auth の一覧の読み出しは auth-client-read.ts だけ" },
  { ac: "AC-001", kind: "violation", path: "web/src/shared/zz-probe.ts", source: "export const go = (url: string) => window.location.replace(url);", label: "SPA を離れる遷移 (location.replace / assign、Navigation.load)" },
  { ac: "AC-001", kind: "allowed", path: "web/src/shared/leave-spa.ts", source: "export const go = (url: string) => window.location.replace(url);", label: "SPA を離れる遷移 (location.replace / assign、Navigation.load)" },
  { ac: "AC-001", kind: "allowed", path: "web/src/shared/zz-probe.ts", source: "export const here = window.location.href;", label: "SPA を離れる遷移 (location.replace / assign、Navigation.load)" },
  { ac: "AC-001", kind: "violation", path: "web/src/shared/zz-probe.ts", source: "export const go = (url: string) => { window.location.href = url; };", label: "同 (location.href への代入)" },
  { ac: "AC-001", kind: "allowed", path: "web/src/shared/zz-probe.ts", source: "export const same = (a: string) => window.location.href === a;", label: "同 (location.href への代入)" },
  { ac: "AC-001", kind: "violation", path: "web/src/shared/zz-probe.ts", source: "import { load } from \"foldkit/navigation\"; export const go = load;", label: "同 (foldkit/navigation の load の import)" },
  { ac: "AC-001", kind: "violation", path: "web/src/company/zz-probe.ts", source: "export const handlers = { onSuccess: () => 1, onFailure: () => 0 };", label: "cause を捨てる onFailure" },
  { ac: "AC-001", kind: "allowed", path: "web/src/company/zz-probe.ts", source: "export const handlers = { onFailure: (cause: unknown) => String(cause) };", label: "cause を捨てる onFailure" },
  { ac: "AC-001", kind: "violation", path: "web/src/company/zz-probe.ts", source: "export const r = Effect.orElseSucceed;", label: "orElseSucceed を書かない" },
  { ac: "AC-001", kind: "violation", path: "web/src/account/zz-probe.ts", source: "export const f = (client: { signOut(): void }) => client.signOut();", label: "sign-out は auth/sign-out.ts だけ" },
  { ac: "AC-001", kind: "allowed", path: "web/src/account/zz-probe.ts", source: "export const f = (model: { signOut: number }) => model.signOut;", label: "sign-out は auth/sign-out.ts だけ" },
  { ac: "AC-001", kind: "violation", path: "web/src/company/zz-probe.ts", source: "export const f = (c: Cause.Cause<unknown>) => Cause.findErrorOption(c);", label: "失敗の _tag の判定は failure-message.ts に集める" },
  { ac: "AC-001", kind: "allowed", path: "web/src/shared/failure-message.ts", source: "export const f = (c: Cause.Cause<unknown>) => Cause.findErrorOption(c);", label: "失敗の _tag の判定は failure-message.ts に集める" },
  { ac: "AC-002", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const secure = process.env.APP_ENV === \"production\";", label: "src で APP_ENV を読むのは sentry-options.ts だけ" },
  { ac: "AC-002", kind: "allowed", path: "src/sentry-options.ts", source: "export const secure = process.env.APP_ENV === \"production\";", label: "src で APP_ENV を読むのは sentry-options.ts だけ" },
  { ac: "AC-002", kind: "violation", path: "web/src/shared/zz-probe.ts", source: "export const isProduction = import.meta.env.PROD;", label: "web/src は vite の build の mode を読まない" },
  { ac: "AC-002", kind: "allowed", path: "web/src/shared/zz-probe.ts", source: "export const token = import.meta.env.VITE_CANARY_TOKEN_ID;", label: "web/src は vite の build の mode を読まない" },
  { ac: "AC-003", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const r = () => runInTransaction(async () => 1);", label: "handlers に runInTransaction が出ない" },
  { ac: "AC-003", kind: "allowed", path: "src/transaction.ts", source: "export const r = () => runInTransaction(async () => 1);", label: "handlers に runInTransaction が出ない" },
  { ac: "AC-003", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const register = (app: { get(path: string): void }) => app.get(\"/api/account/memberships\");", label: "SPA の API (/api/account、/api/mfa) を Hono に直接登録しない" },
  { ac: "AC-003", kind: "allowed", path: "src/account/zz-contract.ts", source: "export const path = \"/api/account/memberships\";", label: "SPA の API (/api/account、/api/mfa) を Hono に直接登録しない" },
  { ac: "AC-003", kind: "violation", path: "src/handlers/zz-http-api.ts", source: "import { HttpServerResponse } from \"effect/http\"; export const r = HttpServerResponse.json({});", label: "HttpApi の handler は HttpServerResponse を直接組まない" },
  { ac: "AC-003", kind: "allowed", path: "src/handlers/zz-http-api.ts", source: "import { HttpServerResponse } from \"effect/http\"; export const r = HttpServerResponse.mergeCookies;", label: "HttpApi の handler は HttpServerResponse を直接組まない" },
  { ac: "AC-003", kind: "violation", path: "src/handlers/zz-http-api.ts", source: "import { AccountPorts } from \"../account/ports\"; export const p = AccountPorts;", label: "SPA の handler は repository の port を値として import しない" },
  { ac: "AC-003", kind: "allowed", path: "src/handlers/zz-http-api.ts", source: "import type { AccountPorts } from \"../account/ports\"; export type P = AccountPorts;", label: "SPA の handler は repository の port を値として import しない" },
  { ac: "AC-004", kind: "violation", path: "db/repositories/zz-probe.ts", source: "import { Effect } from \"effect\"; export const e = Effect;", label: "db/ は effect を import しない" },
  { ac: "AC-004", kind: "violation", path: "db/repositories/zz-probe.ts", source: "import type { Effect } from \"effect\"; export type E = Effect<void>;", label: "db/ は effect を import しない" },
  { ac: "AC-004", kind: "violation", path: "web/src/shared/zz-probe.ts", source: "import { Schema } from \"effect/Schema\"; export const s = Schema;", label: "web/src の effect の subpath は http・crypto・persistence だけ" },
  { ac: "AC-004", kind: "allowed", path: "web/src/shared/zz-probe.ts", source: "import type { HttpClientError } from \"effect/http\"; export type E = HttpClientError.HttpClientError;", label: "web/src の effect の subpath は http・crypto・persistence だけ" },
  { ac: "AC-004", kind: "violation", path: "web/src/company/zz-probe.ts", source: "import { HttpApiClient } from \"effect/http-api\"; export const c = HttpApiClient;", label: "effect/http-api は SpaHttpClient の file だけ" },
  { ac: "AC-004", kind: "allowed", path: "web/src/shared/spa-http-client.ts", source: "// oxlint-disable-next-line no-restricted-imports -- Foldkit の画面の Command が SPA の API の契約から client を作るのはこの file だけ\nimport { HttpApiClient } from \"effect/http-api\"; export const c = HttpApiClient;", label: "effect/http-api は SpaHttpClient の file だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "import * as repo from \"@/db/repositories/membership\"; export const r = repo;", label: "db/repositories と db/transaction の runtime import は限る" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/wiring.ts", source: "import * as repo from \"@/db/repositories/membership\"; export const r = repo;", label: "db/repositories と db/transaction の runtime import は限る" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/zz-probe.ts", source: "import type { MembershipRow } from \"@/db/repositories/membership\"; export type R = MembershipRow;", label: "db/repositories と db/transaction の runtime import は限る" },
  { ac: "AC-004", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const r = () => runInTransaction(async () => 1);", label: "runInTransaction の直呼びは transaction.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/transaction.ts", source: "export const r = () => runInTransaction(async () => 1);", label: "runInTransaction の直呼びは transaction.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = () => Promise.all([1, 2]);", label: "Promise.all の直呼びが 0" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = () => runBackground(1);", label: "runBackground は background.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/background.ts", source: "export const r = () => runBackground(1);", label: "runBackground は background.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = (e: unknown) => Sentry.captureException(e);", label: "Sentry facade の直呼びは sentry.ts と client-facing-error.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/sentry.ts", source: "export const r = (e: unknown) => Sentry.captureException(e);", label: "Sentry facade の直呼びは sentry.ts と client-facing-error.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/company/zz-probe.ts", source: "export const r = (repo: { appendAuditLog(): void }) => repo.appendAuditLog();", label: "audit log の書き込みは audit/append.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/audit/append.ts", source: "export const r = (repo: { appendAuditLog(): void }) => repo.appendAuditLog();", label: "audit log の書き込みは audit/append.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = Effect.orElseSucceed;", label: "silent な fold: orElseSucceed" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = Effect.ignore;", label: "silent な fold: Effect.ignore" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/zz-probe.ts", source: "export const r = Effect.ignoreLogged;", label: "silent な fold: Effect.ignore" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = Effect.logError(\"x\");", label: "Effect.logError は email/client.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/email/client.ts", source: "export const r = Effect.logError(\"x\");", label: "Effect.logError は email/client.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = captureCause({ cause: 1 });", label: "captureCause の直呼びは fail-closed / void の 11 file だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/zz-probe.ts", source: "export const r = captureCauseAs(null, {});", label: "captureCause の直呼びは fail-closed / void の 11 file だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = incrementRateWindow(\"k\");", label: "incrementRateWindow は attempt-budget だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/ttl-store.ts", source: "export const r = incrementRateWindow(\"k\");", label: "incrementRateWindow は attempt-budget だけ" },
  { ac: "AC-004", kind: "violation", path: "src/company/zz-probe.ts", source: "export const r = (repo: { insertMembership(): void }) => repo.insertMembership();", label: "membership 行の増減と role 変更は apply-change だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/apply-change.ts", source: "export const r = (repo: { insertMembership(): void }) => repo.insertMembership();", label: "membership 行の増減と role 変更は apply-change だけ" },
  { ac: "AC-004", kind: "violation", path: "src/company/zz-probe.ts", source: "export const r = (repo: { updateUserLastUsedCompany(): void }) => repo.updateUserLastUsedCompany();", label: "現在の事業所の書き込みは current-company だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/current-company.ts", source: "export const r = (repo: { updateUserLastUsedCompany(): void }) => repo.updateUserLastUsedCompany();", label: "現在の事業所の書き込みは current-company だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = settleCause(1);", label: "settleCause / captureThrown は adapter と better-auth の結線だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/handlers/run-route.ts", source: "export const r = settleCause(1);", label: "settleCause / captureThrown は adapter と better-auth の結線だけ" },
  { ac: "AC-004", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const layer = authApiLayer;", label: "authApiLayer は run-route.ts だけ (識別子)" },
  { ac: "AC-004", kind: "allowed", path: "src/handlers/run-route.ts", source: "export const layer = authApiLayer;", label: "authApiLayer は run-route.ts だけ (識別子)" },
  { ac: "AC-004", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const set = (c: { set(k: string, v: unknown): void }) => c.set(\"authApiLayer\", 1);", label: "authApiLayer を production で set しない (key の文字列)" },
  { ac: "AC-004", kind: "allowed", path: "src/handlers/run-route.ts", source: "export const get = (c: { get(k: string): unknown }) => c.get(\"authApiLayer\");", label: "authApiLayer を production で set しない (key の文字列)" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "import { auth } from \"../auth\"; export const a = auth;", label: "better-auth の auth instance を値で import するのは app.ts と auth-wiring.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/boot.ts", source: "import { initAuth } from \"./auth\"; export const a = initAuth;", label: "better-auth の auth instance を値で import するのは app.ts と auth-wiring.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "import { initAuth } from \"../auth\"; export const a = initAuth;", label: "auth module を値で import するのは app.ts・auth-wiring.ts・boot.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/zz-probe.ts", source: "import type { Auth } from \"../auth\"; export type A = Auth;", label: "auth module を値で import するのは app.ts・auth-wiring.ts・boot.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "management/zz-probe.ts", source: "export const r = initRuntime(1);", label: "initRuntime と initAuth を呼ぶのは boot.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/boot.ts", source: "export const r = initRuntime(1);", label: "initRuntime と initAuth を呼ぶのは boot.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/mfa/zz-probe.ts", source: "export const r = (api: { issueSession(): void }) => api.issueSession();", label: "AuthApi.issueSession は第二要素の検証を終えた complete-login-challenge.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/mfa/totp/complete-login-challenge.ts", source: "export const r = (api: { issueSession(): void }) => api.issueSession();", label: "AuthApi.issueSession は第二要素の検証を終えた complete-login-challenge.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = (api: { getSession(): void }) => api.getSession();", label: "AuthApi.getSession は session-check.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/session-check.ts", source: "export const r = (api: { getSession(): void }) => api.getSession();", label: "AuthApi.getSession は session-check.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const code = (cause: { body: { code: string } }) => cause.body.code;", label: "better-auth の APIError の形を読むのは auth-wiring.ts だけ (member)" },
  { ac: "AC-004", kind: "allowed", path: "src/auth-wiring.ts", source: "export const code = (cause: { body: { code: string } }) => cause.body.code;", label: "better-auth の APIError の形を読むのは auth-wiring.ts だけ (member)" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const code = \"UNAUTHORIZED\";", label: "同 (UNAUTHORIZED の文字列)" },
  { ac: "AC-004", kind: "allowed", path: "src/auth-wiring.ts", source: "export const code = \"UNAUTHORIZED\";", label: "同 (UNAUTHORIZED の文字列)" },
  { ac: "AC-004", kind: "violation", path: "src/membership/__tests__/zz-probe.ts", source: "import { db } from \"@/db/client\"; export const d = db;", label: "src の test の @/db runtime import は test-db.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/__tests__/zz-probe.ts", source: "import type { UserRow } from \"@/db/schema\"; export type U = UserRow;", label: "src の test の @/db runtime import は test-db.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "e2e/zz-probe.ts", source: "import { db } from \"@/db/client\"; export const d = db;", label: "e2e の @/db runtime import は db/testing/* だけ" },
  { ac: "AC-004", kind: "allowed", path: "e2e/fixtures.ts", source: "import { createSeed } from \"@/db/testing/seed\"; export const s = createSeed;", label: "e2e の @/db runtime import は db/testing/* だけ" },
  { ac: "AC-004", kind: "violation", path: "e2e/zz-probe.ts", source: "import { createSeed } from \"@/db/testing/seed\"; export const s = createSeed;", label: "e2e の @/db runtime import は fixtures.ts だけ" },
  { ac: "AC-004", kind: "allowed", path: "e2e/fixtures.ts", source: "import { createSeed } from \"@/db/testing/seed\"; export const s = createSeed;", label: "e2e の @/db runtime import は fixtures.ts だけ" },
  { ac: "AC-004", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const l = Layer.effect(Service, make);", label: "src の Layer constructor は succeed / mergeAll / provide と決まった 2 file だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/zz-probe.ts", source: "export const l = Layer.succeed(Service, value);", label: "src の Layer constructor は succeed / mergeAll / provide と決まった 2 file だけ" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/zz-probe.ts", source: "export const m = Layer.mergeAll(a, b);", label: "src の Layer constructor は succeed / mergeAll / provide と決まった 2 file だけ" },
  { ac: "AC-005", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const x = 1; // note", label: "directive 以外のコメントが 0 件" },
  { ac: "AC-005", kind: "allowed", path: "src/membership/zz-probe.ts", source: "export const url = \"http://example.com\";", label: "directive 以外のコメントが 0 件" },
  { ac: "AC-005", kind: "allowed", path: "src/membership/zz-probe.ts", source: "/// <reference types=\"vite/client\" />", label: "directive 以外のコメントが 0 件" },
  { ac: "AC-005", kind: "allowed", path: "src/membership/zz-probe.ts", source: "// oxlint-disable-next-line no-unused-vars -- 理由\nconst y = 1;", label: "directive 以外のコメントが 0 件" },
  { ac: "AC-005", kind: "allowed", path: "web/src/shared/zz-probe.ts", source: "export const v = import(/* @vite-ignore */ \"x\");", label: "directive 以外のコメントが 0 件" },
  { ac: "AC-006", kind: "violation", path: "src/membership/__tests__/zz-probe.test.ts", source: "test(\"AC-001: 失敗を返す\", () => {});", label: "test 名と .each の行ラベルに設計書の番号が無い" },
  { ac: "AC-006", kind: "allowed", path: "src/membership/__tests__/zz-probe.test.ts", source: "test(\"QA-MR-02 の手順で確かめる\", () => {});", label: "test 名と .each の行ラベルに設計書の番号が無い" },
  { ac: "AC-006", kind: "allowed", path: "src/membership/__tests__/zz-probe.test.ts", source: "test.each([\"AC-001: x\"])(\"振る舞いの文 %s\", () => {});", label: "test 名と .each の行ラベルに設計書の番号が無い" },
  { ac: "AC-007", kind: "violation", path: "src/audit/zz-probe.ts", source: "export const hops = process.env.AUTH_TRUSTED_PROXY_HOPS;", label: "AUTH_TRUSTED_PROXY_HOPS を読む production file は request-context.ts だけ" },
  { ac: "AC-007", kind: "allowed", path: "src/request-context.ts", source: "export const hops = process.env.AUTH_TRUSTED_PROXY_HOPS;", label: "AUTH_TRUSTED_PROXY_HOPS を読む production file は request-context.ts だけ" },
  { ac: "AC-007", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const r = (req: Request) => app.fetch(req);", label: "app に request を渡す (app.fetch) のは 2 つの入口だけ" },
  { ac: "AC-007", kind: "allowed", path: "testing/bun-server.ts", source: "export const r = (req: Request) => app.fetch(req);", label: "app に request を渡す (app.fetch) のは 2 つの入口だけ" },
  { ac: "AC-008", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const key = process.env.AUTH_SERVICE_KEY;", label: "AUTH_SERVICE_KEY の読み手は service-key.ts と testing/server.ts だけ" },
  { ac: "AC-008", kind: "allowed", path: "src/service-key.ts", source: "export const key = process.env.AUTH_SERVICE_KEY;", label: "AUTH_SERVICE_KEY の読み手は service-key.ts と testing/server.ts だけ" },
  { ac: "AC-008", kind: "violation", path: "src/service-key.ts", source: "export const ok = (keys: string[], presented: string) => keys.includes(presented);", label: "鍵の比較に includes を使わない" },
  { ac: "AC-008", kind: "violation", path: "src/service-key.ts", source: "export const ok = (key: string, presented: string) => key === presented;", label: "鍵の比較に === を使わない" },
  { ac: "AC-008", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const h = (c: { req: { header(name: string): string } }) => c.req.header(\"X-Service-Key\");", label: "X-Service-Key header の読み手は app.ts だけ" },
  { ac: "AC-008", kind: "allowed", path: "src/app.ts", source: "export const h = (c: { req: { header(name: string): string } }) => c.req.header(\"X-Service-Key\");", label: "X-Service-Key header の読み手は app.ts だけ" },
  { ac: "AC-008", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const r = (c: { json(body: unknown): unknown }) => c.json({ error: \"x\" });", label: "手書きの応答 body (c.json({ error:) が無い" },
  { ac: "AC-008", kind: "allowed", path: "src/handlers/zz-probe.ts", source: "export const r = (c: { json(body: unknown, status: number): unknown }, report: object) => c.json({ ...report }, 200);", label: "手書きの応答 body (c.json({ error:) が無い" },
  { ac: "AC-009", kind: "violation", path: "src/membership/zz-probe.ts", source: "import * as Sentry from \"@sentry/bun\"; export const s = Sentry;", label: "Sentry の SDK を import するのは runtime ごとの初期化 file と worker.ts だけ" },
  { ac: "AC-009", kind: "allowed", path: "src/membership/zz-probe.ts", source: "import type { Event } from \"@sentry/core\"; export type E = Event;", label: "Sentry の SDK を import するのは runtime ごとの初期化 file と worker.ts だけ" },
  { ac: "AC-010", kind: "violation", path: "src/auth-plugins/zz-probe.ts", source: "import { enroll } from \"../mfa/totp\"; export const e = enroll;", label: "auth-plugins が import してよい mfa の module は 4 つに限る" },
  { ac: "AC-010", kind: "allowed", path: "src/auth-plugins/mfa-challenge.ts", source: "import { guard } from \"../mfa/redirect-guard\"; export const g = guard;", label: "auth-plugins が import してよい mfa の module は 4 つに限る" },
  { ac: "AC-010", kind: "violation", path: "src/mfa/zz-probe.ts", source: "export const on = process.env.MFA_CHALLENGE_ENABLED;", label: "kill switch の env を読むのは一次認証の after-hook だけ" },
  { ac: "AC-010", kind: "allowed", path: "src/auth-plugins/primary-auth.ts", source: "export const on = process.env.MFA_CHALLENGE_ENABLED;", label: "kill switch の env を読むのは一次認証の after-hook だけ" },
  { ac: "AC-010", kind: "violation", path: "src/mfa/totp/zz-probe.ts", source: "export const cookie = \"sid=1; HttpOnly\";", label: "cookie の属性を手で書かない" },
  { ac: "AC-010", kind: "violation", path: "src/auth-plugins/zz-probe.ts", source: "import type { MfaTotpRow } from \"@/db/repositories/mfa-totp\"; export type R = MfaTotpRow;", label: "db/repositories/mfa-totp を import する production code は決まった file だけ" },
  { ac: "AC-010", kind: "allowed", path: "src/mfa/totp/ports.ts", source: "import type { MfaTotpRow } from \"@/db/repositories/mfa-totp\"; export type R = MfaTotpRow;", label: "db/repositories/mfa-totp を import する production code は決まった file だけ" },
  { ac: "AC-010", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const name = \"mfa_login_challenge\";", label: "チャレンジの cookie 名の文字列は login-challenge.ts だけ" },
  { ac: "AC-010", kind: "allowed", path: "src/mfa/totp/login-challenge.ts", source: "export const name = \"mfa_login_challenge\";", label: "チャレンジの cookie 名の文字列は login-challenge.ts だけ" },
  { ac: "AC-010", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const r = findMfaTotp(\"u\");", label: "secret を返す findMfaTotp を使う code は決まった file だけ" },
  { ac: "AC-010", kind: "allowed", path: "src/mfa/totp/verify-code.ts", source: "export const r = findMfaTotp(\"u\");", label: "secret を返す findMfaTotp を使う code は決まった file だけ" },
  { ac: "AC-010", kind: "violation", path: "src/mfa/zz-probe.ts", source: "export const at = (row: { verifiedAt: Date }) => row.verifiedAt;", label: "verifiedAt を読む production code は policy.ts だけ" },
  { ac: "AC-010", kind: "allowed", path: "src/mfa/policy.ts", source: "export const at = (row: { verifiedAt: Date }) => row.verifiedAt;", label: "verifiedAt を読む production code は policy.ts だけ" },
  { ac: "AC-010", kind: "violation", path: "management/zz-probe.ts", source: "import { db } from \"../db/client\"; export const d = db;", label: "management/ の import 面は全列挙で固定する" },
  { ac: "AC-010", kind: "allowed", path: "management/disable-user-mfa.ts", source: "import { boot } from \"../src/boot\"; export const b = boot;", label: "management/ の import 面は全列挙で固定する" },
  { ac: "AC-010", kind: "violation", path: "db/repositories/zz-probe.ts", source: "import { failure } from \"../../src/failures\"; export const f = failure;", label: "db/ は src/ を import しない" },
  { ac: "AC-011", kind: "violation", path: "src/mfa/policy.ts", source: "import { Effect } from \"effect\"; export const x = Effect;", label: "policy.ts は import 0 件" },
  { ac: "AC-012", kind: "violation", path: "src/membership/guard/zz-probe.ts", source: "import type { Context } from \"hono\"; export type C = Context;", label: "guard/*.ts・policy.ts・accept.ts は型も値も hono を import しない" },
  { ac: "AC-013", kind: "violation", path: "src/company/zz-probe.ts", source: "export const v = {} as Verified<object>;", label: "Verified への cast は guard の中だけ" },
  { ac: "AC-013", kind: "allowed", path: "src/membership/guard/zz-probe.ts", source: "export const v = {} as Verified<object>;", label: "Verified への cast は guard の中だけ" },
  { ac: "AC-013", kind: "violation", path: "src/company/zz-probe.ts", source: "export const v = verified({});", label: "印を付ける verified を呼ぶのは guard の中だけ" },
  { ac: "AC-013", kind: "allowed", path: "src/membership/guard/zz-probe.ts", source: "export const v = verified({});", label: "印を付ける verified を呼ぶのは guard の中だけ" },
  { ac: "AC-014", kind: "violation", path: "src/company/zz-probe.ts", source: "export const r = findCompaniesBlockingUserDeletion(\"u\");", label: "sole OWNER の検査と OWNER 行の lock は delete-account.ts だけ" },
  { ac: "AC-014", kind: "allowed", path: "src/account/delete-account.ts", source: "export const r = findCompaniesBlockingUserDeletion(\"u\");", label: "sole OWNER の検査と OWNER 行の lock は delete-account.ts だけ" },
  { ac: "AC-014", kind: "violation", path: "src/company/zz-probe.ts", source: "export const r = deleteAccount(\"u\");", label: "deleteAccount を呼ぶのは delete-account.ts と orphan.ts だけ" },
  { ac: "AC-014", kind: "allowed", path: "src/account/orphan.ts", source: "export const r = deleteAccount(\"u\");", label: "deleteAccount を呼ぶのは delete-account.ts と orphan.ts だけ" },
  { ac: "AC-014", kind: "violation", path: "src/company/zz-probe.ts", source: "export const r = (api: { deleteUser(): void }) => api.deleteUser();", label: ".deleteUser は delete-account.ts だけ" },
  { ac: "AC-014", kind: "allowed", path: "src/account/delete-account.ts", source: "export const r = (api: { deleteUser(): void }) => api.deleteUser();", label: ".deleteUser は delete-account.ts だけ" },
  { ac: "AC-014", kind: "violation", path: "db/repositories/membership.ts", source: "export const q = sql`SELECT id FROM membership WHERE role = 'OWNER' FOR UPDATE`;", label: "OWNER 行の lock は全て id 順に取る" },
  { ac: "AC-014", kind: "allowed", path: "db/repositories/membership.ts", source: "export const q = sql`SELECT id FROM membership WHERE role = 'OWNER' ORDER BY id FOR UPDATE`;", label: "OWNER 行の lock は全て id 順に取る" },
  { ac: "AC-014", kind: "violation", path: "src/auth.ts", source: "export const config = { user: { deleteUser: { enabled: true } } };", label: "better-auth の退会 endpoint を有効にしない" },
  { ac: "AC-014", kind: "violation", path: "src/account/zz-probe.ts", source: "export const r = (store: { deleteUserSessions(): void }) => store.deleteUserSessions();", label: "deleteUserSessions を呼ぶのは delete-sessions.ts と auth-wiring.ts だけ" },
  { ac: "AC-014", kind: "allowed", path: "src/account/delete-sessions.ts", source: "export const r = (store: { deleteUserSessions(): void }) => store.deleteUserSessions();", label: "deleteUserSessions を呼ぶのは delete-sessions.ts と auth-wiring.ts だけ" },
  { ac: "AC-014", kind: "violation", path: "src/company/zz-probe.ts", source: "export const r = deleteSessionsOf(\"u\");", label: "deleteSessionsOf を呼ぶのは delete-account.ts だけ" },
  { ac: "AC-014", kind: "allowed", path: "src/account/delete-account.ts", source: "export const r = deleteSessionsOf(\"u\");", label: "deleteSessionsOf を呼ぶのは delete-account.ts だけ" },
  { ac: "AC-015", kind: "violation", path: "src/auth-plugins/zz-probe.ts", source: "export const path = \"/magic-link/verify\";", label: "一次認証 route と provider の literal 比較は primary-auth-routes.ts だけ" },
  { ac: "AC-015", kind: "allowed", path: "src/auth-plugins/primary-auth-routes.ts", source: "export const path = \"/magic-link/verify\";", label: "一次認証 route と provider の literal 比較は primary-auth-routes.ts だけ" },
  { ac: "AC-016", kind: "violation", path: "src/email/zz-probe.ts", source: "export const t = \"raw\" as DisplayText;", label: "DisplayText への cast は sanitize.ts の toDisplayText だけ" },
  { ac: "AC-016", kind: "allowed", path: "src/email/sanitize.ts", source: "export const t = \"raw\" as DisplayText;", label: "DisplayText への cast は sanitize.ts の toDisplayText だけ" },
  { ac: "AC-017", kind: "violation", path: "src/handlers/zz-probe.ts", source: "export const r = (db: { ping(): void }) => db.ping();", label: "probe の呼び手は probe.ts だけ" },
  { ac: "AC-017", kind: "allowed", path: "src/health/probe.ts", source: "export const r = (db: { ping(): void }) => db.ping();", label: "probe の呼び手は probe.ts だけ" },
  { ac: "AC-017", kind: "violation", path: "db/repositories/health.ts", source: "export const ping = async () => { try { await Promise.resolve(); } catch { return; } };", label: "repository と driver は失敗を握らない (catch が無い)" },
  { ac: "AC-017", kind: "violation", path: "src/app.ts", source: "export const r = (app: { get(path: string): void }) => app.get(\"/health\");", label: "app.ts に `app.get(\"/health\"` を書かない" },
  { ac: "AC-017", kind: "violation", path: "src/app.ts", source: "import { HealthPorts } from \"./health/ports\"; export const p = HealthPorts;", label: "app.ts は health/ports と ttl-store-service を直接触らない" },
  { ac: "AC-017", kind: "violation", path: "src/handlers/health.ts", source: "export const r = () => Effect.runPromise(program);", label: "handlers/health.ts は runtime を直接呼ばない" },
  { ac: "AC-018", kind: "violation", path: "db/zz-probe.ts", source: "export const local = (host: string) => LOCAL_DATABASE_HOSTNAMES.has(host);", label: "local の host の集合で判定するのは local-database.ts だけ" },
  { ac: "AC-018", kind: "allowed", path: "db/testing/local-database.ts", source: "export const local = (host: string) => LOCAL_DATABASE_HOSTNAMES.has(host);", label: "local の host の集合で判定するのは local-database.ts だけ" },
  { ac: "AC-018", kind: "violation", path: "db/zz-probe.ts", source: "export const host = new URL(process.env.DATABASE_URL!).hostname;", label: "DATABASE_URL を URL として読む file が無い" },
  { ac: "AC-019", kind: "violation", path: "src/membership/zz-probe.ts", source: "export const r = (api: { createUser(): void }) => api.createUser();", label: "AuthApi.createUser を呼ぶのは試験の利用者を作る use-case だけ" },
  { ac: "AC-019", kind: "allowed", path: "testing/create-signed-in-user.ts", source: "export const r = (api: { createUser(): void }) => api.createUser();", label: "AuthApi.createUser を呼ぶのは試験の利用者を作る use-case だけ" },
  { ac: "AC-019", kind: "violation", path: "testing/zz-probe.ts", source: "export const production = process.env.APP_ENV === \"production\";", label: "testing/ で APP_ENV を読むのは判定の file と isOutsideProduction に渡す行だけ" },
  { ac: "AC-019", kind: "allowed", path: "testing/server.ts", source: "if (!isOutsideProduction(process.env.APP_ENV)) { process.exit(1); }", label: "testing/ で APP_ENV を読むのは判定の file と isOutsideProduction に渡す行だけ" },
  { ac: "AC-020", kind: "violation", path: "src/runtime.ts", source: "import { Pool } from \"pg\"; export const p = Pool;", label: "runtime.ts は db/client と ttl-store を値で import しない" },
  { ac: "AC-020", kind: "allowed", path: "src/runtime.ts", source: "import type { Pool } from \"pg\"; export type P = Pool;", label: "runtime.ts は db/client と ttl-store を値で import しない" },
  { ac: "AC-021", kind: "violation", path: "testing/zz-probe.ts", source: "export const r = switchCurrentCompany({ userId: \"u\", companyId: \"c\" });", label: "試験の module で現在の事業所を書き換えるのは 2 つの use-case だけ" },
  { ac: "AC-021", kind: "allowed", path: "testing/set-current-company.ts", source: "export const r = switchCurrentCompany({ userId: \"u\", companyId: \"c\" });", label: "試験の module で現在の事業所を書き換えるのは 2 つの use-case だけ" },
  { ac: "AC-005", kind: "violation", path: "src/membership/zz-comment.ts", source: "export const a = 1; // trailing", label: "directive 以外のコメント" },
  { ac: "AC-005", kind: "violation", path: "src/membership/zz-comment.ts", source: "/* block */\nexport const b = 1;", label: "directive 以外のコメント" },
  { ac: "AC-005", kind: "violation", path: "src/membership/zz-comment.ts", source: "export const t = (x: number) => `a$" + "{/* inner */ x}`;", label: "directive 以外のコメント" },
  { ac: "AC-005", kind: "violation", path: "src/membership/zz-comment.ts", source: "// eslint-disable-next-line no-console\nexport const c = 1;", label: "directive 以外のコメント" },
  { ac: "AC-005", kind: "violation", path: "src/membership/zz-comment.ts", source: "// biome-ignore lint/style: x\nexport const d = 1;", label: "directive 以外のコメント" },
  { ac: "AC-005", kind: "allowed", path: "src/membership/zz-comment.ts", source: "export const re = /\\/\\//g;", label: "文字列・正規表現・template・除算と directive" },
  { ac: "AC-005", kind: "allowed", path: "src/membership/zz-comment.ts", source: "export const t = `a // b`;", label: "文字列・正規表現・template・除算と directive" },
  { ac: "AC-005", kind: "allowed", path: "src/membership/zz-comment.ts", source: "export const q = (a: number, b: number, c: number) => a / b / c;", label: "文字列・正規表現・template・除算と directive" },
  { ac: "AC-005", kind: "allowed", path: "src/membership/zz-comment.ts", source: "// @ts-expect-error 型の検査\nexport const e: number = \"x\";", label: "文字列・正規表現・template・除算と directive" },
  { ac: "AC-005", kind: "allowed", path: "src/membership/zz-comment.ts", source: "/// <reference types=\"vite/client\" />\nexport const r = 1;", label: "文字列・正規表現・template・除算と directive" },
  { ac: "AC-006", kind: "violation", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"QA-H-02 事業所を切り替える\", () => {});", label: "設計書の番号" },
  { ac: "AC-006", kind: "violation", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"F-1 失敗の宣言\", () => {});", label: "設計書の番号" },
  { ac: "AC-006", kind: "violation", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"G1: token が無い\", () => {});", label: "設計書の番号" },
  { ac: "AC-006", kind: "violation", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"T1 発行した cookie を読む\", () => {});", label: "設計書の番号" },
  { ac: "AC-006", kind: "violation", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"Stage 2 ゲート\", () => {});", label: "設計書の番号" },
  { ac: "AC-006", kind: "violation", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"Hono の route の登録 (#52)\", () => {});", label: "設計書の番号" },
  { ac: "AC-006", kind: "allowed", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"ADR-0017 の境界を守る\", () => {});", label: "repo に定義のある番号と一般の用語" },
  { ac: "AC-006", kind: "allowed", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"C0 制御文字の上端\", () => {});", label: "repo に定義のある番号と一般の用語" },
  { ac: "AC-006", kind: "allowed", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"UTF-8 の文字列\", () => {});", label: "repo に定義のある番号と一般の用語" },
  { ac: "AC-006", kind: "allowed", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"SHA-256 の digest\", () => {});", label: "repo に定義のある番号と一般の用語" },
  { ac: "AC-006", kind: "allowed", path: "src/membership/__tests__/zz-names.test.ts", source: "test(\"RFC 6265 の cookie\", () => {});", label: "repo に定義のある番号と一般の用語" },
  { ac: "AC-001", kind: "violation", path: "web/src/mfa/mfa-api.ts", source: "export const f = () => fetch(\"/x\");", label: "-api.ts の名前でも fetch" },
  { ac: "AC-001", kind: "violation", path: "web/src/company/pages/Companies.ts", source: "export const r = (exit: unknown, Exit: { match: (e: unknown, h: unknown) => number }) => Exit.match(exit, { onSuccess: () => 1, onFailure: () => 0 });", label: "cause を捨てる onFailure" },
  { ac: "AC-004", kind: "violation", path: "e2e/zz-import.ts", source: "import {\n  db,\n  schema,\n} from \"@/db/client\";\nexport const d = [db, schema];", label: "e2e の @/db の値の import" },
  { ac: "AC-004", kind: "violation", path: "e2e/zz-import.ts", source: "export const load = () => import(\"@/db/client\");", label: "e2e の @/db の値の import" },
  { ac: "AC-004", kind: "violation", path: "e2e/zz-import.ts", source: "import \"@/db/client\";", label: "e2e の @/db の値の import" },
  { ac: "AC-004", kind: "violation", path: "e2e/zz-import.ts", source: "import db from \"@/db/client\";\nexport const d = db;", label: "e2e の @/db の値の import" },
  { ac: "AC-004", kind: "violation", path: "e2e/zz-import.ts", source: "export { db } from \"@/db/client\";", label: "e2e の @/db の値の import" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/__tests__/zz-import.ts", source: "import type {\n  UserRow,\n} from \"@/db/schema\";\nexport type U = UserRow;", label: "src の test の @/db の型の import" },
  { ac: "AC-004", kind: "allowed", path: "src/membership/__tests__/zz-import.ts", source: "export type { DbTx } from \"@/db/transaction\";", label: "src の test の @/db の型の import" },
];

const MOVED_CHECK_TITLES: Readonly<Record<string, string>> = {
  "AC-001": "web-data-access.test.ts が落とした違反",
  "AC-002": "no-environment-branch.test.ts が落とした違反",
  "AC-003": "no-transport-tx.test.ts が落とした違反",
  "AC-004": "effect-boundary.test.ts が落とした違反",
  "AC-005": "no-code-comments.test.ts が落とした comment",
  "AC-006": "test-names.test.ts が落とした設計書の番号",
  "AC-007": "request-context.test.ts が走査で落とした違反",
  "AC-008": "service-key.test.ts が走査で落とした違反",
  "AC-009": "sentry.test.ts が走査で落とした import",
  "AC-010": "mfa の containment.test.ts が走査で落とした違反",
  "AC-011": "mfa の policy.test.ts が走査で落とした import",
  "AC-012": "no-hono-import.test.ts が落とした import",
  "AC-013": "membership の containment.test.ts が落とした違反",
  "AC-014": "account の containment.test.ts が落とした違反",
  "AC-015": "auth-plugins の containment.test.ts が走査で落とした literal",
  "AC-016": "email の containment.test.ts が走査で落とした cast",
  "AC-017": "health の containment.test.ts が走査で落とした違反",
  "AC-018": "db の containment.test.ts が落とした違反",
  "AC-019": "testing の containment.test.ts が走査で落とした違反",
  "AC-020": "runtime.test.ts が走査で落とした import",
  "AC-021": "testing の default-company-contract.test.ts が走査で落とした書き換え",
};

const LINT_ALL_FIXTURES_TIMEOUT_MS = 120_000;

beforeAll(() => {
  for (const group of groupsWithDistinctPaths([...MOVED_CHECK_FIXTURES, ...WEB_RULE_FIXTURES])) {
    lintGroup(group);
  }
}, LINT_ALL_FIXTURES_TIMEOUT_MS);

afterAll(() => {
  for (const fixtureDir of fixtureDirs) rmSync(fixtureDir, { recursive: true, force: true });
});

const stoppingCodesOf = (fixture: Fixture) => stoppingCodesByFixture.get(fixture) ?? ["未実行"];

describe("source を走査する test が落とした違反を、lint が同じ path で止める", () => {
  for (const [ac, title] of Object.entries(MOVED_CHECK_TITLES)) {
    const fixtures = MOVED_CHECK_FIXTURES.filter((fixture) => fixture.ac === ac);
    test.each(fixtures.filter(({ kind }) => kind === "violation"))(
      `${ac}: ${title}を置くと lint が error を出す: $label ($path)`,
      (fixture) => {
        expect(stoppingCodesOf(fixture)).not.toEqual([]);
      },
    );
    const allowed = fixtures.filter(({ kind }) => kind === "allowed");
    if (allowed.length > 0) {
      test.each(allowed)(
        `${ac}: ${title}について、元の test が許した file と書き方では lint が止めない: $label ($path)`,
        (fixture) => {
          expect(stoppingCodesOf(fixture)).toEqual([]);
        },
      );
    }
  }
});

const FULLY_MOVED_TEST_FILES = [
  "src/__tests__/web-data-access.test.ts",
  "src/__tests__/no-environment-branch.test.ts",
  "src/__tests__/effect-boundary.test.ts",
  "src/__tests__/no-code-comments.test.ts",
  "src/__tests__/test-names.test.ts",
  "src/handlers/__tests__/no-transport-tx.test.ts",
  "src/membership/__tests__/no-hono-import.test.ts",
  "src/membership/__tests__/containment.test.ts",
  "src/account/__tests__/containment.test.ts",
  "db/__tests__/containment.test.ts",
] as const;

const MOVED_TEST_NAMES = [
  "env を読む production file は request-context.ts だけ (boot guard も proxyTrustFromEnv を通る)",
  "app に request を渡すのは、IP の header を入口で置き直す 2 つの入口だけ (ほかの入口から渡すと client が書いた header を信じる)",
  "AUTH_SERVICE_KEY の読み手は service-key.ts と Bun の入口 (testing/server.ts) の boot guard だけ",
  "鍵の比較は timingSafeEqual (digest 経由) だけで、includes / === を使わない",
  "X-Service-Key header の読み手は app.ts の /rpc/* middleware 1 行だけ",
  "手書きの応答 body (c.json({ error:) は production src に無い",
  "Sentry の SDK を import するのは runtime ごとの初期化 file と worker.ts だけ (共通の sentry.ts から import すると Workers の bundle に @sentry/bun が混ざる)",
  "auth-plugins が import してよい mfa モジュールは 4 つに限る",
  "kill switch の env を読むのは一次認証の after-hook だけ (program は引数で受ける)",
  "AuthApi.issueSession の session cookie は hono の serialize で組み、属性を手で書かない (session cookie の契約)",
  "db/repositories/mfa-totp を import する production code は決まった file だけ",
  "チャレンジの cookie 名の文字列は login-challenge.ts だけが持つ",
  "secret を返す findMfaTotp を使う code は決まった file だけ",
  "verifiedAt を読む production code は policy.ts だけ (db/ は列を持つ層なので対象外)",
  "management/ の import 面は全列挙で固定する",
  "db/ は src/ を import しない (identity DB を分離する時に逆向きの依存を作らない)",
  "述語は import 0 件 — verified_at を直接比較する第 2 の判定経路が生えない",
  "一次認証 route と provider の literal 比較は primary-auth-routes.ts だけ (parser 1 本に集約)",
  "DisplayText への cast は sanitize.ts の toDisplayText だけ",
  "probe の呼び手は src/health/probe.ts だけ",
  "repository と driver は失敗を握らず void で返す",
  "app.ts は handlers/health を mountStatic より前に route し、probe service を直接触らない",
  "handlers/health.ts は runRoute で走らせ runtime を直接呼ばない",
  "AuthApi.createUser を呼ぶのは、試験の利用者を作る use-case だけ",
  "testing/ で APP_ENV を読むのは、判定の file と isOutsideProduction に渡す行だけ",
  "runtime.ts は db/client と ttl-store を値で import しない (Layer に I/O resource を持たせない)",
  "試験の module で現在の事業所を書き換えるのは、試験の利用者を作る use-case と現在の事業所を切り替える use-case だけ",
] as const;

describe("移した test と規則の参照先", () => {
  test("AC-022: 全部の検査を移した test file を repo に置かない", () => {
    expect(gitFiles(...FULLY_MOVED_TEST_FILES)).toEqual([]);
  });

  test.each(MOVED_TEST_NAMES.map((name) => ({ name })))(
    "AC-022: 移した検査の test 名を repo の test に書かない: $name",
    ({ name }) => {
      expect(
        gitGrep(
          name,
          ":(glob)src/**/*.test.ts",
          ":(glob)db/**/*.test.ts",
          ":(glob)testing/**/*.test.ts",
        ),
      ).toEqual([]);
    },
  );

  test("AC-023: src/CLAUDE.md の「静的な検査」の節が、lint の rule の置き場 (lint/ の下の path) を名指す", () => {
    const claude = read("src/CLAUDE.md");
    const start = claude.indexOf("## 静的な検査");
    const rest = claude.slice(start + 1);
    const end = rest.search(/^## /m);
    const section = start < 0 ? "" : rest.slice(0, end < 0 ? undefined : end);
    expect(section).toMatch(/`lint\/[^`]+`/);
  });
});

const WEB_RULE_FIXTURES: readonly Fixture[] = [
  {
    ac: "AC-024",
    kind: "violation",
    path: "web/src/company/zz-tag-probe.ts",
    source:
      'import { Effect } from "effect";\nexport const recover = (program: Effect.Effect<number, { readonly _tag: string }>) =>\n  program.pipe(Effect.catchIf((error) => error._tag === "Forbidden", () => Effect.succeed(0)));',
    label: "Effect.catchIf で _tag を比べる",
  },
  {
    ac: "AC-025",
    kind: "violation",
    path: "web/src/app/account/zz-navigation-probe.ts",
    source:
      'import * as DocumentNavigation from "../document-navigation";\nimport { signInRouter } from "../auth/route";\nexport const go = () => DocumentNavigation.PushUrl({ href: signInRouter({}) });',
    label: "PushUrl に /auth の router の path を渡す",
  },
  {
    ac: "AC-025",
    kind: "violation",
    path: "web/src/app/account/zz-foldkit-navigation-probe.ts",
    source:
      'import { pushUrl } from "foldkit/navigation";\nimport { signInRouter } from "../auth/route";\nexport const go = () => pushUrl(signInRouter({}));',
    label: "foldkit の pushUrl に /auth の router の path を渡す",
  },
  {
    ac: "AC-025",
    kind: "allowed",
    path: "web/src/app/account/zz-navigation-probe.ts",
    source:
      'import * as DocumentNavigation from "../document-navigation";\nimport { companiesRouter } from "./route";\nexport const go = () => DocumentNavigation.PushUrl({ href: companiesRouter() });',
    label: "PushUrl に自分の application の router の path を渡す",
  },
  {
    ac: "AC-028",
    kind: "violation",
    path: "web/src/shared/zz-inner-html-probe.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const raw = <Message>(h: HtmlBuilder<Message>) => h.div([h.InnerHTML("<b>x</b>")], []);',
    label: "web/src に h.InnerHTML",
  },
  {
    ac: "AC-028",
    kind: "violation",
    path: "web/non-production/zz-inner-html-probe.ts",
    source:
      'import type { HtmlBuilder } from "foldkit/html";\nexport const raw = <Message>(h: HtmlBuilder<Message>) => h.div([h.InnerHTML("<b>x</b>")], []);',
    label: "web/non-production に h.InnerHTML",
  },
];

const webRuleFixtures = (ac: string, kind: Fixture["kind"]) =>
  WEB_RULE_FIXTURES.filter((fixture) => fixture.ac === ac && fixture.kind === kind);

describe("台帳の D の行と h.InnerHTML を仕組みで止める", () => {
  test.each(webRuleFixtures("AC-024", "violation"))(
    "AC-024: web/src の本番の file で Effect.catchIf に失敗の _tag を比べる述語を渡すと lint が error を出す: $label",
    (fixture) => {
      expect(stoppingCodesOf(fixture)).not.toEqual([]);
    },
  );

  test.each(webRuleFixtures("AC-025", "violation"))(
    "AC-025: /account の application が /auth の path を client 側の遷移に渡すと lint が error を出す: $label",
    (fixture) => {
      expect(stoppingCodesOf(fixture)).not.toEqual([]);
    },
  );

  test.each(webRuleFixtures("AC-025", "allowed"))(
    "AC-025: 自分の application の router の path を client 側の遷移に渡すと lint は止めない: $label",
    (fixture) => {
      expect(stoppingCodesOf(fixture)).toEqual([]);
    },
  );

  test("AC-026: 一覧の読み出しを、失敗の応答を空の一覧として成功にする形に置き換えると、bun test web/src/account か bun run typecheck が落ちる", () => {
    const path = join(REPO_ROOT, "web/src/account/auth-client-read.ts");
    const original = readFileSync(path, "utf8");
    const checksPass = () =>
      run("bun", ["test", "web/src/account"]).status === 0 &&
      run("bun", ["run", "typecheck"]).status === 0;
    expect(checksPass()).toBe(true);
    try {
      writeFileSync(
        path,
        [
          'import { Data, Effect } from "effect";',
          "",
          'import { signInClient } from "../auth/sign-in-client";',
          "",
          'class AuthClientReadFailed extends Data.TaggedError("AuthClientReadFailed") {}',
          "",
          "type AuthClientResponse<A> = Readonly<{ data: A | null; error: unknown }>;",
          "",
          "const readAuthClient = <A>(read: () => Promise<AuthClientResponse<A>>) =>",
          "  Effect.tryPromise({ try: read, catch: () => new AuthClientReadFailed() }).pipe(",
          "    Effect.map(({ data }) => data ?? []),",
          "  );",
          "",
          "export const listSessions = readAuthClient(() => signInClient.listSessions());",
          "",
          "export const listLinkedAccounts = readAuthClient(() => signInClient.listAccounts());",
          "",
        ].join("\n"),
      );
      expect(checksPass()).toBe(false);
    } finally {
      writeFileSync(path, original);
    }
  }, 300_000);

  test("AC-027: web/src/CLAUDE.md に、仕組みで止めるようにした 3 つの規則の文を書かない", () => {
    expect(
      gitGrep("失敗の `_tag` を直接比べない", "web/src/CLAUDE.md").concat(
        gitGrep("better-auth の client が返す `error`", "web/src/CLAUDE.md"),
        gitGrep("`/auth` と `/account` をまたぐ遷移", "web/src/CLAUDE.md"),
      ),
    ).toEqual([]);
  });

  test.each(webRuleFixtures("AC-028", "violation"))(
    "AC-028: web の file に h.InnerHTML を書くと lint が error を出す: $label",
    (fixture) => {
      expect(stoppingCodesOf(fixture)).not.toEqual([]);
    },
  );
});

const ORIGIN = "https://auth.taimei-code.com";

const urlOf = (href: string) =>
  Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`));

const COMPANY_A = {
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE",
  role: "OWNER",
} as const;

const COMPANY_B = {
  companyId: "company-b",
  companyName: "事業所B",
  orgCode: "PERSONAL",
  role: "ADMIN",
} as const;

const stateOf = (currentCompanyId: string) => ({
  maybeCurrentCompanyId: Option.some(currentCompanyId),
  memberships: [COMPANY_A, COMPANY_B],
});

type AnyCommand = { name: string; args?: Record<string, unknown> };

const commandsOf = (result: { commands?: ReadonlyArray<unknown> }) =>
  (result.commands ?? []) as ReadonlyArray<AnyCommand>;

const currentCompanyMessage = (message: CurrentCompany.Message) =>
  Message.GotCurrentCompanyMessage({ message });

const membersMessage = (message: Members.Message) => Message.GotMembersMessage({ message });

const invitationsMessage = (message: MemberInvitations.Message) =>
  membersMessage(Members.Message.GotMemberInvitationsMessage({ message }));

const pageVisitOf = (model: Model): number =>
  Option.match(model.maybePage, {
    onNone: () => -1,
    onSome: (page) => ("visit" in page.model ? (page.model.visit as number) : -1),
  });

const MEMBER = {
  userId: "user-member",
  label: "メンバー太郎",
  email: "member@example.com",
  role: "MEMBER",
} as const;

const ROLE_CHANGED_TEXT = "メンバー太郎 の役割を管理者に変更しました。";

const membersShown = (): Model => {
  const opened = update(
    init(urlOf(`${ORIGIN}/account/members`)).model,
    Message.SucceededLoadCompanyState({ state: stateOf(COMPANY_A.companyId) }),
  ).model;
  const visit = pageVisitOf(opened);
  return [
    membersMessage(
      Members.Message.CompletedReadSelfUserId({ visit, maybeUserId: Option.some("user-owner") }),
    ),
    membersMessage(
      Members.Message.SucceededLoadMembers({ visit, members: [MEMBER], reload: { _tag: "Opened" } }),
    ),
  ].reduce((current, each) => update(current, each).model, opened);
};

const after = (start: Model, ...messages: ReadonlyArray<Message>): Model =>
  messages.reduce((current, each) => update(current, each).model, start);

const changingRole = () =>
  after(membersShown(), membersMessage(Members.Message.SelectedRole({ member: MEMBER, value: "ADMIN" })));

const removing = () =>
  after(
    membersShown(),
    membersMessage(Members.Message.ClickedRemove({ member: MEMBER })),
    membersMessage(Members.Message.ClickedConfirmRemoval()),
  );

const inviting = () =>
  after(
    membersShown(),
    invitationsMessage(MemberInvitations.Message.UpdatedEmail({ value: "new@example.com" })),
    invitationsMessage(MemberInvitations.Message.SubmittedInvitation()),
  );

const revoking = () =>
  after(
    membersShown(),
    invitationsMessage(MemberInvitations.Message.ClickedRevoke({ invitationId: "invitation-1" })),
  );

const selectB = currentCompanyMessage(
  CurrentCompany.Message.SelectedCompany({ companyId: COMPANY_B.companyId }),
);

const hasSwitchCompany = (commands: ReadonlyArray<AnyCommand>) =>
  commands.some((command) => command.name === CurrentCompany.SwitchCompany.name);

const latestRefreshNumberOf = (model: Model): number =>
  model.entry._tag === "Ready" ? model.entry.currentCompany.refreshNumber : 0;

const finishSwitchIfSent = (model: Model, commands: ReadonlyArray<AnyCommand>): Model => {
  if (!hasSwitchCompany(commands)) {
    return model;
  }
  const switched = update(model, currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()));
  return update(
    switched.model,
    currentCompanyMessage(
      CurrentCompany.Message.SucceededRefreshCompanyState({
        refreshNumber: latestRefreshNumberOf(switched.model),
        state: stateOf(COMPANY_B.companyId),
        maybeDoneText: Option.none(),
      }),
    ),
  ).model;
};

const resolveMembersReload = (model: Model, commands: ReadonlyArray<AnyCommand>): Model => {
  const reload = commands.find((command) => command.name === Members.LoadMembers.name);
  if (reload === undefined) {
    return model;
  }
  const args = reload.args as { visit: number; reload: Parameters<typeof Members.Message.SucceededLoadMembers>[0]["reload"] };
  return update(
    model,
    membersMessage(
      Members.Message.SucceededLoadMembers({
        visit: args.visit,
        members: [{ ...MEMBER, role: "ADMIN" }],
        reload: args.reload,
      }),
    ),
  ).model;
};

const roleChangeSucceeded = (model: Model, visit: number) => {
  const changed = update(
    model,
    membersMessage(
      Members.Message.SucceededChangeRole({
        visit,
        texts: { doneText: ROLE_CHANGED_TEXT, actionText: "役割を変更しました" },
      }),
    ),
  );
  return resolveMembersReload(changed.model, commandsOf(changed));
};

const testBlocksIn = (path: string): string[] =>
  read(path)
    .split(/\btest(?:\.each\([\s\S]*?\))?\(/)
    .slice(1);

describe("メンバーの画面の送信中の切り替え", () => {
  test("AC-029: 役割の変更の送信中に枠の select で別の事業所を選んでも、切り替えを送らない", () => {
    expect(hasSwitchCompany(commandsOf(update(changingRole(), selectB)))).toBe(false);
  });

  test("AC-030: 削除の送信中に枠の select で別の事業所を選んでも、切り替えを送らない", () => {
    expect(hasSwitchCompany(commandsOf(update(removing(), selectB)))).toBe(false);
  });

  test("AC-031: 招待の送信中に枠の select で別の事業所を選んでも、切り替えを送らない", () => {
    expect(hasSwitchCompany(commandsOf(update(inviting(), selectB)))).toBe(false);
  });

  test("AC-031: 招待の取り消しの送信中に枠の select で別の事業所を選んでも、切り替えを送らない", () => {
    expect(hasSwitchCompany(commandsOf(update(revoking(), selectB)))).toBe(false);
  });

  test("AC-032: 役割の変更の送信中は、枠の「事業所を切り替え」の select を選べない", () => {
    scene(
      { update, view },
      givenScene(changingRole()),
      expectScene(role("combobox", { name: "事業所を切り替え" })).toBeDisabled(),
    );
  });

  test("AC-033: 役割の変更の送信中に別の事業所を選んでも、変更の成功と一覧の読み直しが届けば完了を通知する", () => {
    const changing = changingRole();
    const visit = pageVisitOf(changing);
    const selected = update(changing, selectB);
    const afterSwitch = finishSwitchIfSent(selected.model, commandsOf(selected));
    const done = roleChangeSucceeded(afterSwitch, visit);
    expect(done.toast.entries.map((entry) => entry.payload.text)).toContain(ROLE_CHANGED_TEXT);
  });

  test("AC-034: 役割の変更の成功と一覧の読み直しが届いた後は、枠の select で別の事業所を選ぶと切り替えを送る", () => {
    const changing = changingRole();
    const done = roleChangeSucceeded(changing, pageVisitOf(changing));
    expect(hasSwitchCompany(commandsOf(update(done, selectB)))).toBe(true);
  });

  test("AC-034: 役割の変更の失敗が届いた後は、枠の select で別の事業所を選ぶと切り替えを送る", () => {
    const changing = changingRole();
    const failed = after(
      changing,
      membersMessage(
        Members.Message.FailedChangeRole({ visit: pageVisitOf(changing), failure: "Forbidden" }),
      ),
    );
    expect(hasSwitchCompany(commandsOf(update(failed, selectB)))).toBe(true);
  });

  test("AC-035: web/src の story か scene の test に、メンバーの画面の送信中に事業所を選ぶ test がある", () => {
    const blocks = gitFiles(
      ":(glob)web/src/**/*.story.test.ts",
      ":(glob)web/src/**/*.scene.test.ts",
    ).flatMap(testBlocksIn);
    expect(
      blocks.some(
        (block) =>
          ["SelectedRole", "ClickedConfirmRemoval", "SubmittedInvitation", "ClickedRevoke"].some(
            (sent) => block.includes(sent),
          ) && block.includes("SelectedCompany"),
      ),
    ).toBe(true);
  });
});
