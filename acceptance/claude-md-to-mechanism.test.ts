import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Option } from "effect";
import { fromString } from "foldkit/url";

import { urlToAuthRoute } from "../web/src/app/auth/route";

const REPO_ROOT = join(import.meta.dir, "..");

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

const run = (command: string, args: readonly string[], cwd = REPO_ROOT) =>
  spawnSync(command, [...args], { cwd, encoding: "utf8", env: shellEnv, timeout: 300_000 });

const linesOf = (stdout: string): string[] => stdout.split("\n").filter((line) => line !== "");

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] =>
  linesOf(run("git", ["grep", "-n", "-E", "--untracked", pattern, "--", ...pathspecs]).stdout);

const gitGrepFixed = (text: string, ...pathspecs: string[]): string[] =>
  linesOf(run("git", ["grep", "-n", "-F", "--untracked", text, "--", ...pathspecs]).stdout);

const gitFiles = (...pathspecs: string[]): string[] =>
  linesOf(
    run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs])
      .stdout,
  ).filter((path) => existsSync(join(REPO_ROOT, path)));

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const isTestPath = (hit: string) => hit.includes("/__tests__/");

const RULE_DOCUMENTS = [
  "CLAUDE.md",
  "src/CLAUDE.md",
  "db/CLAUDE.md",
  "e2e/CLAUDE.md",
  "infra/CLAUDE.md",
  "packages/auth-client/CLAUDE.md",
  "web/src/CLAUDE.md",
] as const;

const BYTES_BEFORE = 32_973;

const MECHANIZED_RULE_SENTENCES = [
  "直接 import しない。将来 `db/` を別 process に切り出して",
  "例外の追加は DB 境界の設計変更として review し",
  "handler から `db.select()` や `db.insert()` を呼ばない",
  "status は class の `httpApiStatus` にだけ書く",
  "producer は `tryDb`",
  "渡す effect の失敗は渡す前に catch する",
  "時刻は `Clock.currentTimeMillis`",
  "`HttpApiSchema.WithHeaders` は複数の Set-Cookie",
  "policy 述語、repository への直接 write、transaction は持たない",
  "`process.cwd()` から path を組む",
  "reuseExistingServer",
  "ログインは `helpers.ts` の `signInWithMagicLink`",
  "`sentLinkAfter(email, 送る操作)`",
  "`routeEndpoint(page,",
  "`@/` は root の tsconfig では",
  "失敗の文言は各画面に置く",
  "1 つの表を共有する",
  "認証の状態が変わった後の遷移は",
  "5 層を目視で audit する",
  "先に `bun run --cwd packages/auth-client build`",
  "docker compose up auth-postgres",
  "shellcheck scripts/*.sh",
] as const;

const CONTRADICTED_SENTENCES = [
  "以上の境界を破る書き方は",
  "の削除と更新は repository を作らず",
  "`pg.Pool` を module singleton にしない",
  "同期 helper (`generate*`)",
  "no-design-number-in-test-name",
  "web/non-production/assets.ts",
  "`beforeEach` で `reseedFixture` を呼ぶ",
  "merge の前に手元の credential で走らせる手順は無く",
  "他の CLAUDE.md や ADR が path で名指さない",
  "仕組みで守れない規則",
] as const;

const KEPT_RULE_TOPICS = [
  { document: "CLAUDE.md", topic: "QA-MR" },
  { document: "web/src/CLAUDE.md", topic: "route の parser" },
  { document: "src/CLAUDE.md", topic: "closure" },
  { document: "src/CLAUDE.md", topic: "afterCommit" },
] as const;

type Fixture = {
  readonly ac: string;
  readonly kind: "violation" | "allowed";
  readonly path: string;
  readonly source: string;
  readonly label: string;
};

type Diagnostic = { readonly code: string; readonly filename: string; readonly severity: string };

const STOPPING_CODE = /^(taimei\(|eslint\(no-restricted-)/;

const DB_CLIENT_FROM_SRC_HANDLERS = 'import { db } from "../../db/client";\nexport const d = db;';
const RUN_PROMISE =
  "export const run = (runtime: { runPromise: (effect: unknown) => unknown }, effect: unknown) => runtime.runPromise(effect);";
const FORK_DETACH =
  'import { Effect } from "effect";\nexport const forked = Effect.forkDetach(Effect.void);';
const CONNECT_ERROR =
  'import { Code, ConnectError } from "@connectrpc/connect";\nexport const failed = new ConnectError("x", Code.Internal);';
const PAGE_ROUTE =
  'export const mock = (page: { route: (url: string, handler: () => void) => unknown }) => page.route("**/x", () => {});';
const LOG_AND_LOGIN_LINK =
  'export const log = "e2e/.server.log";\nexport const path = "/testing/v1/login-links";';
const TAG_KEY = 'export const body = { _tag: "LastOwner" };';
const LEAVE_SPA_FROM = (specifier: string) =>
  `import { leaveSpaTo } from "${specifier}";\nexport const leave = leaveSpaTo;`;
const FAILURE_TABLE = (exported: boolean) =>
  `import type { FailureMessages } from "../shared/failure-message";\n${exported ? "export " : ""}const MESSAGES: FailureMessages<{ readonly _tag: "A" }> = { A: "a", Unexpected: "u" };\nexport const text = MESSAGES.A;`;
const MFA_TABLE_FROM = (specifier: string) =>
  `import { mfaFailureText } from "${specifier}";\nexport const text = mfaFailureText;`;

const FIXTURES: readonly Fixture[] = [
  { ac: "AC-009", kind: "violation", path: "src/handlers/zz-db-probe.ts", source: DB_CLIENT_FROM_SRC_HANDLERS, label: "src が相対 path で db/client を import する" },
  { ac: "AC-009", kind: "violation", path: "src/company/zz-drizzle-probe.ts", source: 'import { sql } from "drizzle-orm/sql";\nexport const s = sql;', label: "src が drizzle-orm の subpath を import する" },
  { ac: "AC-009", kind: "violation", path: "src/handlers/zz-pg-probe.ts", source: 'import { Pool } from "pg";\nexport const p = Pool;', label: "src が pg を import する" },
  { ac: "AC-009", kind: "violation", path: "src/company/zz-core-probe.ts", source: 'import { db } from "@core/../db/client";\nexport const d = db;', label: "src が @core/ から db/client を import する" },
  { ac: "AC-009", kind: "violation", path: "src/__tests__/zz-db-probe.ts", source: DB_CLIENT_FROM_SRC_HANDLERS, label: "src の test が相対 path で db/client を import する" },
  { ac: "AC-009", kind: "violation", path: "testing/zz-db-probe.ts", source: 'import { db } from "../db/client";\nexport const d = db;', label: "testing が相対 path で db/client を import する" },
  { ac: "AC-009", kind: "violation", path: "testing/__tests__/zz-drizzle-probe.ts", source: 'import { drizzle } from "drizzle-orm/node-postgres";\nexport const d = drizzle;', label: "testing の test が drizzle-orm を import する" },
  { ac: "AC-009", kind: "violation", path: "web/src/company/zz-db-probe.ts", source: 'import { db } from "../../../db/client";\nexport const d = db;', label: "web が相対 path で db/client を import する" },
  { ac: "AC-009", kind: "violation", path: "packages/auth-client/src/zz-db-probe.ts", source: 'import * as schema from "../../../db/schema";\nexport const s = schema;', label: "SDK が相対 path で db/schema を import する" },
  { ac: "AC-009", kind: "violation", path: "infra/zz-pg-probe.ts", source: 'import { Pool } from "pg";\nexport const p = Pool;', label: "infra が pg を import する" },
  { ac: "AC-009", kind: "violation", path: "e2e/zz-db-probe.ts", source: 'import { db } from "../db/client";\nexport const d = db;', label: "e2e が相対 path で db/client を import する" },
  { ac: "AC-010", kind: "violation", path: "db/repositories/zz-pg-probe.ts", source: 'import { Pool } from "pg";\nexport const p = Pool;', label: "db/client.ts の外の db の file が pg を import する" },
  { ac: "AC-011", kind: "allowed", path: "db/client.ts", source: 'import { Pool } from "pg";\nexport const p = Pool;', label: "db/client.ts は pg を import できる" },
  { ac: "AC-011", kind: "allowed", path: "src/auth.ts", source: 'import { db } from "@/db/client";\nimport * as schema from "@/db/schema";\nexport const adapter = [db, schema];', label: "src/auth.ts は db/client と db/schema を import できる" },
  { ac: "AC-011", kind: "allowed", path: "src/worker.ts", source: 'import { runWithRequestPool } from "@/db/client";\nexport const pooled = runWithRequestPool;', label: "src/worker.ts は directive 無しで db/client を import できる" },
  { ac: "AC-011", kind: "allowed", path: "src/__tests__/test-db.ts", source: 'import * as seed from "@/db/testing/seed";\nexport const s = seed;', label: "test-db.ts は db/testing を import できる" },
  { ac: "AC-011", kind: "allowed", path: "testing/zz-seed-probe.ts", source: 'import * as seed from "../db/testing/seed";\nexport const s = seed;', label: "testing は db/testing を import できる" },
  { ac: "AC-011", kind: "allowed", path: "testing/__tests__/zz-seed-probe.ts", source: 'import * as seed from "../../db/testing/seed";\nexport const s = seed;', label: "testing の test は db/testing を import できる" },
  { ac: "AC-011", kind: "allowed", path: "src/company/zz-type-probe.ts", source: 'import type { CompanyRow } from "../../db/repositories/company";\nexport type C = CompanyRow;', label: "src は db/repositories を型で import できる" },
  { ac: "AC-011", kind: "allowed", path: "src/company/zz-enum-probe.ts", source: 'import { ROLES } from "../../db/enums";\nexport const r = ROLES;', label: "src は db/enums を import できる" },
  { ac: "AC-013", kind: "violation", path: "src/company/zz-failure-probe.ts", source: 'import { Schema } from "effect";\nexport class Probe extends Schema.TaggedError<Probe>()("Probe", {}) {}', label: "status を書かずに Schema.TaggedError を宣言する" },
  { ac: "AC-014", kind: "violation", path: "src/email/zz-boundary-probe.ts", source: 'import { EmailError } from "../errors";\nexport const failed = new EmailError({ cause: 1 });', label: "src/errors.ts の外で EmailError を new する" },
  { ac: "AC-014", kind: "violation", path: "src/company/zz-boundary-probe.ts", source: 'import { DbError } from "../errors";\nexport const failed = new DbError({ cause: 1 });', label: "src/errors.ts の外で DbError を new する" },
  { ac: "AC-014", kind: "allowed", path: "src/errors.ts", source: "class DbError {\n  constructor(readonly fields: { readonly cause: unknown }) {}\n}\nexport const failed = new DbError({ cause: 1 });", label: "src/errors.ts は境界の失敗を new できる" },
  { ac: "AC-017", kind: "violation", path: "src/company/zz-run-probe.ts", source: RUN_PROMISE, label: "一覧に無い file が runPromise を呼ぶ" },
  { ac: "AC-017", kind: "violation", path: "src/company/zz-clock-probe.ts", source: "export const now = () => Date.now();", label: "Date.now() を呼ぶ" },
  { ac: "AC-017", kind: "violation", path: "src/company/zz-id-probe.ts", source: "export const id = () => crypto.randomUUID();", label: "crypto.randomUUID() を呼ぶ" },
  { ac: "AC-017", kind: "violation", path: "src/company/zz-driver-probe.ts", source: 'import * as driver from "../kv-store.memory";\nexport const d = driver;', label: "entry の外が TTL store の driver を import する" },
  { ac: "AC-017", kind: "violation", path: "src/company/zz-email-probe.ts", source: 'import * as welcome from "../email/send-welcome";\nexport const w = welcome;', label: "email の外が send-* を import する" },
  { ac: "AC-017", kind: "violation", path: "src/company/zz-fork-probe.ts", source: FORK_DETACH, label: "background.ts の外が Effect.forkDetach を書く" },
  { ac: "AC-017", kind: "violation", path: "src/rpc/zz-connect-probe.ts", source: CONNECT_ERROR, label: "run-rpc.ts の外が ConnectError を書く" },
  { ac: "AC-017", kind: "violation", path: "src/handlers/zz-headers-probe.ts", source: "declare const HttpApiSchema: { readonly WithHeaders: unknown };\nexport const headers = HttpApiSchema.WithHeaders;", label: "HttpApiSchema.WithHeaders を書く" },
  { ac: "AC-018", kind: "violation", path: "src/handlers/zz-policy-probe.ts", source: 'import * as policy from "../membership/policy";\nexport const p = policy;', label: "Transport が policy を import する" },
  { ac: "AC-018", kind: "violation", path: "src/rpc/zz-tx-probe.ts", source: 'import * as transaction from "../transaction";\nexport const t = transaction;', label: "Transport が transaction を import する" },
  { ac: "AC-018", kind: "violation", path: "src/rpc/zz-port-probe.ts", source: 'import * as ports from "../company/ports";\nexport const p = ports;', label: "一覧に無い Transport の file が port を import する" },
  { ac: "AC-018", kind: "violation", path: "src/membership/guard/zz-hono-probe.ts", source: 'import { getCookie } from "hono/cookie";\nexport const g = getCookie;', label: "Guard が hono/cookie を import する" },
  { ac: "AC-018", kind: "violation", path: "src/company/zz-path-probe.ts", source: 'export const path = "/api/company/settings";', label: "契約の外の file が /api/company の path を書く" },
  { ac: "AC-018", kind: "violation", path: "src/company/services/zz-probe.ts", source: "export const x = 1;", label: "services/ に file を置く" },
  { ac: "AC-018", kind: "violation", path: "src/utils/zz-probe.ts", source: "export const x = 1;", label: "utils/ に file を置く" },
  { ac: "AC-019", kind: "allowed", path: "src/handlers/run-route.ts", source: RUN_PROMISE, label: "adapter は runPromise を呼べる" },
  { ac: "AC-019", kind: "allowed", path: "src/background.ts", source: FORK_DETACH, label: "background.ts は Effect.forkDetach を書ける" },
  { ac: "AC-019", kind: "allowed", path: "src/rpc/run-rpc.ts", source: CONNECT_ERROR, label: "run-rpc.ts は ConnectError を書ける" },
  { ac: "AC-019", kind: "allowed", path: "src/boot.ts", source: 'import * as driver from "./kv-store.memory";\nexport const d = driver;', label: "boot.ts は TTL store の driver を import できる" },
  { ac: "AC-019", kind: "allowed", path: "src/company/zz-auth-path-probe.ts", source: 'export const path = "/api/auth/sign-out";', label: "/api/auth の path は書ける" },
  { ac: "AC-023", kind: "violation", path: "e2e/zz-fixtures-probe.e2e.ts", source: 'import * as fixtures from "./fixtures";\nexport const f = fixtures;', label: "spec が ./fixtures を import する" },
  { ac: "AC-023", kind: "violation", path: "e2e/zz-route-probe.e2e.ts", source: PAGE_ROUTE, label: "spec が page.route を呼ぶ" },
  { ac: "AC-023", kind: "violation", path: "e2e/zz-log-probe.e2e.ts", source: 'export const log = "e2e/.server.log";', label: "spec が .server.log を書く" },
  { ac: "AC-023", kind: "violation", path: "e2e/zz-login-probe.e2e.ts", source: 'export const path = "/testing/v1/login-links";', label: "spec が /login-links を書く" },
  { ac: "AC-023", kind: "violation", path: "e2e/zz-tag-probe.e2e.ts", source: TAG_KEY, label: "spec が _tag を key に書く" },
  { ac: "AC-024", kind: "allowed", path: "e2e/zz-names-probe.e2e.ts", source: 'import * as names from "./fixture-names";\nexport const n = names;', label: "spec は ./fixture-names を import できる" },
  { ac: "AC-024", kind: "allowed", path: "e2e/helpers.ts", source: LOG_AND_LOGIN_LINK, label: "helpers.ts は .server.log と /login-links を書ける" },
  { ac: "AC-024", kind: "allowed", path: "e2e/contract-mock.ts", source: `${PAGE_ROUTE}\n${TAG_KEY}`, label: "contract-mock.ts は page.route と _tag を書ける" },
  { ac: "AC-027", kind: "violation", path: "web/src/company/zz-leave-probe.ts", source: LEAVE_SPA_FROM("../shared/leave-spa"), label: "domain の file が shared/leave-spa を import する" },
  { ac: "AC-027", kind: "violation", path: "web/src/account/pages/zz-leave-probe.ts", source: LEAVE_SPA_FROM("../../shared/leave-spa"), label: "page が shared/leave-spa を import する" },
  { ac: "AC-027", kind: "allowed", path: "web/src/app/account/zz-leave-probe.ts", source: LEAVE_SPA_FROM("../../shared/leave-spa"), label: "application の file は shared/leave-spa を import できる" },
  { ac: "AC-030", kind: "violation", path: "web/src/company/zz-table-probe.ts", source: FAILURE_TABLE(true), label: "FailureMessages 型の表を export する" },
  { ac: "AC-030", kind: "allowed", path: "web/src/company/zz-local-table-probe.ts", source: FAILURE_TABLE(false), label: "export しない表は書ける" },
  { ac: "AC-031", kind: "violation", path: "web/src/account/zz-mfa-table-probe.ts", source: MFA_TABLE_FROM("../mfa/mfa-failure-messages"), label: "mfa の外が MFA の表を import する" },
  { ac: "AC-031", kind: "allowed", path: "web/src/mfa/zz-mfa-table-probe.ts", source: MFA_TABLE_FROM("./mfa-failure-messages"), label: "mfa の file は MFA の表を import できる" },
  { ac: "AC-032", kind: "violation", path: "packages/auth-client/src/zz-effect-probe.ts", source: 'import { Option } from "effect";\nexport const o = Option;', label: "SDK が effect を import する" },
  { ac: "AC-032", kind: "violation", path: "packages/auth-client/src/zz-hono-probe.ts", source: 'import type { Context } from "hono";\nexport type C = Context;', label: "SDK が hono を型で import する" },
  { ac: "AC-032", kind: "violation", path: "packages/auth-client/src/zz-next-probe.ts", source: 'import Link from "next/link";\nexport const l = Link;', label: "SDK が next/link を import する" },
  { ac: "AC-032", kind: "violation", path: "packages/auth-client/src/zz-node-probe.ts", source: 'import { Buffer } from "node:buffer";\nexport const b = Buffer;', label: "SDK が node:buffer を import する" },
  { ac: "AC-032", kind: "allowed", path: "packages/auth-client/src/zz-connect-probe.ts", source: 'import { Code } from "@connectrpc/connect";\nexport const c = Code;', label: "SDK は peerDependencies の package を import できる" },
  { ac: "AC-032", kind: "allowed", path: "packages/auth-client/src/zz-protobuf-probe.ts", source: 'import { fileDesc } from "@bufbuild/protobuf/codegenv2";\nexport const f = fileDesc;', label: "SDK は peerDependencies の package の subpath を import できる" },
  { ac: "AC-032", kind: "allowed", path: "packages/auth-client/src/zz-relative-probe.ts", source: 'import * as types from "./types";\nexport const t = types;', label: "SDK は相対 path を import できる" },
];

const FIXTURE_TITLES: Readonly<Record<string, string>> = {
  "AC-009": "db の外から DB に触れる import",
  "AC-010": "db/client.ts の外の pg の import",
  "AC-011": "DB の import の例外と、型・enum の import",
  "AC-013": "status の無い失敗の宣言",
  "AC-014": "境界の失敗の new",
  "AC-017": "program が書けない副作用",
  "AC-018": "Transport と Guard と配置の禁止",
  "AC-019": "副作用を書いてよい file",
  "AC-023": "e2e の spec が書けない primitive",
  "AC-024": "e2e の helper と名前の import",
  "AC-027": "document を離れる関数の import",
  "AC-030": "失敗の文言の表の export",
  "AC-031": "MFA の失敗の文言の表の import",
  "AC-032": "SDK の外部 package の import",
};

const configWithAbsolutePlugins = (): string => {
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

const temporaryDirs: string[] = [];

const temporaryDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
};

const writeInto = (dir: string, path: string, content: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};

const stoppingCodesByFixture = new Map<Fixture, string[]>();

const lintFixtures = (fixtures: readonly Fixture[]): void => {
  const dir = temporaryDir("acceptance-431-lint-");
  writeInto(dir, ".oxlintrc.json", configWithAbsolutePlugins());
  writeInto(dir, "packages/auth-client/package.json", read("packages/auth-client/package.json"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  for (const { path, source } of fixtures) {
    writeInto(dir, path, `${source}\n`);
  }
  const result = run(
    join(REPO_ROOT, "node_modules/.bin/oxlint"),
    ["--disable-nested-config", "--format", "json", ...fixtures.map(({ path }) => path)],
    dir,
  );
  const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  for (const fixture of fixtures) {
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

const stoppingCodesOf = (fixture: Fixture) => stoppingCodesByFixture.get(fixture) ?? ["未実行"];

const BACKGROUND_PROBE = (effect: string) =>
  `import { Effect } from "effect";\nimport { Background } from "${join(REPO_ROOT, "src/background")}";\nexport const probe = Effect.gen(function* () {\n  const background = yield* Background;\n  yield* background.run(${effect});\n});\n`;

const typecheckStatusByProbe = new Map<string, number | null>();

const typecheckProbes = (probes: Readonly<Record<string, string>>): void => {
  const dir = temporaryDir("acceptance-431-types-");
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  const tsc = run(join(REPO_ROOT, "node_modules/.bin/effect-tsgo"), ["get-exe-path"]).stdout.trim();
  for (const [name, source] of Object.entries(probes)) {
    writeInto(dir, `${name}.ts`, source);
    writeInto(
      dir,
      `tsconfig.${name}.json`,
      JSON.stringify({
        extends: join(REPO_ROOT, "tsconfig.json"),
        compilerOptions: { composite: false, incremental: false },
        include: [join(dir, `${name}.ts`)],
        exclude: [],
      }),
    );
    typecheckStatusByProbe.set(
      name,
      run(tsc, ["--noEmit", "-p", join(dir, `tsconfig.${name}.json`)], dir).status,
    );
  }
};

const STATIC_CHECK = ["test", "./src/__tests__/static-check-index.test.ts"] as const;
const SDK_BUILD = ["run", "--cwd", "packages/auth-client", "build"] as const;
const SDK_TEST = ["test", "./packages/auth-client"] as const;
const SDK_DIST = "packages/auth-client/dist";
const ENABLED_TAIMEI_RULE = /^\s*"taimei\/[a-z-]+": "error",\n/m;

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

const withoutGrowing = (content: string, inserted: string): string => {
  let kept = content;
  while (byteLength(kept + inserted) > byteLength(content)) {
    kept = kept.slice(0, -1);
  }
  return kept + inserted;
};

type TreeObservation = {
  readonly sdkDistAfterTypecheck: boolean;
  readonly sdkDistAfterBunTest: boolean;
  readonly staticCheck: number | null;
  readonly staticCheckWithRuleName: number | null;
  readonly staticCheckWithTestPath: number | null;
  readonly staticCheckWithMoreBytes: number | null;
  readonly staticCheckWithDisabledRule: number | null;
  readonly sdkBuild: number | null;
  readonly sdkBuildUsingProcess: number | null;
  readonly sdkTest: number | null;
  readonly sdkTestWithChangedType: number | null;
};

let observed: TreeObservation | undefined;

const linkNodeModules = (tree: string): void => {
  const source = join(REPO_ROOT, "node_modules");
  const target = join(tree, "node_modules");
  mkdirSync(join(target, "@taimei-code"), { recursive: true });
  for (const entry of readdirSync(source)) {
    if (entry !== ".cache" && entry !== "@taimei-code") {
      symlinkSync(join(source, entry), join(target, entry));
    }
  }
  symlinkSync(join(tree, "packages/auth-client"), join(target, "@taimei-code/auth-client"));
  const sdkModules = join(REPO_ROOT, "packages/auth-client/node_modules");
  if (existsSync(sdkModules)) {
    symlinkSync(sdkModules, join(tree, "packages/auth-client/node_modules"));
  }
};

const copyOfWorkingTree = (): string => {
  const tree = temporaryDir("acceptance-431-tree-");
  for (const file of gitFiles(".").filter((path) => !path.startsWith("repos/"))) {
    mkdirSync(dirname(join(tree, file)), { recursive: true });
    cpSync(join(REPO_ROOT, file), join(tree, file), { verbatimSymlinks: true });
  }
  linkNodeModules(tree);
  run("git", ["init", "-q"], tree);
  run("git", ["add", "-A"], tree);
  return tree;
};

const observeTree = (): TreeObservation => {
  const tree = copyOfWorkingTree();
  const inTree = (command: string, args: readonly string[]) => run(command, args, tree).status;
  const mutated = (
    file: string,
    mutate: (content: string) => string,
    observe: () => number | null,
  ): number | null => {
    const original = readFileSync(join(tree, file), "utf8");
    writeFileSync(join(tree, file), mutate(original));
    try {
      return observe();
    } finally {
      writeFileSync(join(tree, file), original);
    }
  };
  const sdkDistExists = () => existsSync(join(tree, SDK_DIST, "index.d.ts"));
  const staticCheck = () => inTree("bun", STATIC_CHECK);
  const buildThenTestSdk = () => {
    inTree("bun", SDK_BUILD);
    return inTree("bun", SDK_TEST);
  };

  inTree("bash", ["scripts/typecheck.sh"]);
  const sdkDistAfterTypecheck = sdkDistExists();
  rmSync(join(tree, SDK_DIST), { recursive: true, force: true });
  inTree("bun", STATIC_CHECK);
  const sdkDistAfterBunTest = sdkDistExists();

  const sdkBuild = inTree("bun", SDK_BUILD);
  return {
    sdkDistAfterTypecheck,
    sdkDistAfterBunTest,
    staticCheck: staticCheck(),
    staticCheckWithRuleName: mutated(
      "e2e/CLAUDE.md",
      (content) => withoutGrowing(content, "\n- `taimei/no-promise-all` が止める。\n"),
      staticCheck,
    ),
    staticCheckWithTestPath: mutated(
      "e2e/CLAUDE.md",
      (content) => withoutGrowing(content, "\n- `src/__tests__/source-scan.test.ts` が固定する。\n"),
      staticCheck,
    ),
    staticCheckWithMoreBytes: mutated(
      "e2e/CLAUDE.md",
      (content) => `${content}\n- ${"規則の文を足す。".repeat(40)}\n`,
      staticCheck,
    ),
    staticCheckWithDisabledRule: mutated(
      ".oxlintrc.json",
      (content) => content.replace(ENABLED_TAIMEI_RULE, ""),
      staticCheck,
    ),
    sdkBuild,
    sdkBuildUsingProcess: mutated(
      "packages/auth-client/src/url-builder.ts",
      (content) => `${content}\nexport const zzAcceptanceProbe = process.env.HOME;\n`,
      () => inTree("bun", SDK_BUILD),
    ),
    sdkTest: buildThenTestSdk(),
    sdkTestWithChangedType: mutated(
      "packages/auth-client/src/index.ts",
      (content) => `${content}\nexport type ZzAcceptanceProbe = { readonly zz: 1 };\n`,
      buildThenTestSdk,
    ),
  };
};

const SETUP_TIMEOUT_MS = 600_000;

beforeAll(() => {
  lintFixtures(FIXTURES);
  typecheckProbes({
    "background-failing": BACKGROUND_PROBE('Effect.fail("boom" as const)'),
    "background-infallible": BACKGROUND_PROBE("Effect.succeed(1)"),
  });
  observed = observeTree();
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  for (const dir of temporaryDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const failsOnlyWhenMutated = (control: number | null | undefined, mutated: number | null | undefined) => ({
  control,
  mutatedFails: mutated !== 0,
});

const FAILS_ONLY_WHEN_MUTATED = { control: 0, mutatedFails: true };

describe("規則の正本は違反した時の message と test 名で、CLAUDE.md は担保の写しを持たない", () => {
  test("AC-001: repos/ 以外の CLAUDE.md に、lint の rule 名と test file の path を書かない", () => {
    expect(
      gitGrep(String.raw`taimei/[a-z]|[A-Za-z0-9_./-]+\.test\.tsx?`, ...RULE_DOCUMENTS),
    ).toEqual([]);
  });

  test("AC-002: CLAUDE.md に lint の rule 名を書くと、static-check-index.test.ts が落ちる", () => {
    expect(failsOnlyWhenMutated(observed?.staticCheck, observed?.staticCheckWithRuleName)).toEqual(
      FAILS_ONLY_WHEN_MUTATED,
    );
  });

  test("AC-002: CLAUDE.md に test file の path を書くと、static-check-index.test.ts が落ちる", () => {
    expect(failsOnlyWhenMutated(observed?.staticCheck, observed?.staticCheckWithTestPath)).toEqual(
      FAILS_ONLY_WHEN_MUTATED,
    );
  });

  test("AC-003: CLAUDE.md の合計 byte を増やすと、static-check-index.test.ts が落ちる", () => {
    expect(failsOnlyWhenMutated(observed?.staticCheck, observed?.staticCheckWithMoreBytes)).toEqual(
      FAILS_ONLY_WHEN_MUTATED,
    );
  });

  test("AC-004: .oxlintrc.json から taimei の rule の有効化を 1 つ外すと、static-check-index.test.ts が落ちる", () => {
    expect(
      failsOnlyWhenMutated(observed?.staticCheck, observed?.staticCheckWithDisabledRule),
    ).toEqual(FAILS_ONLY_WHEN_MUTATED);
  });

  test("AC-005: repos/ 以外の CLAUDE.md の合計は、変更前の 32,973 B より小さい", () => {
    const total = RULE_DOCUMENTS.reduce((sum, document) => sum + byteLength(read(document)), 0);
    expect(total).toBeLessThan(BYTES_BEFORE);
  });

  test.each(MECHANIZED_RULE_SENTENCES.map((sentence) => ({ sentence })))(
    "AC-006: CLAUDE.md に、仕組みにした規則の文を書かない: $sentence",
    ({ sentence }) => {
      expect(gitGrepFixed(sentence, ...RULE_DOCUMENTS)).toEqual([]);
    },
  );

  test.each(CONTRADICTED_SENTENCES.map((sentence) => ({ sentence })))(
    "AC-007: CLAUDE.md に、code と食い違っていた文を書かない: $sentence",
    ({ sentence }) => {
      expect(gitGrepFixed(sentence, ...RULE_DOCUMENTS)).toEqual([]);
    },
  );

  test.each(KEPT_RULE_TOPICS)(
    "AC-008: 仕組みにしなかった規則は $document に残る: $topic",
    ({ document, topic }) => {
      expect(gitGrepFixed(topic, document)).not.toEqual([]);
    },
  );
});

describe("違反を置くと lint が error を出し、許した file と書き方では出さない", () => {
  for (const [ac, title] of Object.entries(FIXTURE_TITLES)) {
    const fixtures = FIXTURES.filter((fixture) => fixture.ac === ac);
    const violations = fixtures.filter(({ kind }) => kind === "violation");
    if (violations.length > 0) {
      test.each(violations)(`${ac}: ${title}を置くと lint が error を出す: $label ($path)`, (fixture) => {
        expect(stoppingCodesOf(fixture)).not.toEqual([]);
      });
    }
    const allowed = fixtures.filter(({ kind }) => kind === "allowed");
    if (allowed.length > 0) {
      test.each(allowed)(`${ac}: ${title}について、lint は止めない: $label ($path)`, (fixture) => {
        expect(stoppingCodesOf(fixture)).toEqual([]);
      });
    }
  }
});

describe("DB の import の禁止と例外は 1 か所にある", () => {
  test("AC-012: .oxlintrc.json に drizzle-orm・pg・@/db/ の禁止を書かない", () => {
    expect(gitGrep(String.raw`drizzle-orm|"pg"|@/db/`, ".oxlintrc.json")).toEqual([]);
  });

  test("AC-012: src/worker.ts に no-restricted-imports を黙らせる directive を書かない", () => {
    expect(gitGrep(String.raw`oxlint-disable[a-z-]* .*no-restricted-imports`, "src/worker.ts")).toEqual(
      [],
    );
  });
});

describe("失敗と副作用の置き場", () => {
  test("AC-015: src/errors.ts と test 以外の src に、境界の失敗の new を書かない", () => {
    expect(
      gitGrep(String.raw`new (DbError|AuthApiError|TtlStoreError|EmailError)\(`, "src").filter(
        (hit) => !isTestPath(hit) && !hit.startsWith("src/errors.ts:"),
      ),
    ).toEqual([]);
  });

  test("AC-016: Background.run に失敗し得る effect を渡すと型エラーになる", () => {
    expect({
      infallible: typecheckStatusByProbe.get("background-infallible"),
      failingIsRejected: typecheckStatusByProbe.get("background-failing") !== 0,
    }).toEqual({ infallible: 0, failingIsRejected: true });
  });

  test("AC-020: src/mfa の test 以外の file に Date.now() と crypto.randomUUID() を書かない", () => {
    expect(
      gitGrep(String.raw`Date\.now\(\)|crypto\.randomUUID\(\)`, "src/mfa").filter(
        (hit) => !isTestPath(hit),
      ),
    ).toEqual([]);
  });
});

describe("e2e は実行ごとに server を起動し、cwd に依らない", () => {
  test("AC-021: playwright.config.ts に、起動済みの server を使い回す設定を書かない", () => {
    expect(gitGrep(String.raw`reuseExistingServer: *(true|!|process)`, "playwright.config.ts")).toEqual(
      [],
    );
  });

  test("AC-022: e2e の TS と playwright.config.ts に process.cwd() を書かない", () => {
    expect(
      gitGrep(String.raw`process\.cwd\(\)`, ":(glob)e2e/**/*.ts", "playwright.config.ts"),
    ).toEqual([]);
  });

  test("AC-025: e2e の spec に page.route( を書かない", () => {
    expect(gitGrep(String.raw`page\.route\(`, ":(glob)e2e/*.e2e.ts")).toEqual([]);
  });

  test("AC-026: e2e の test 名に、GLOSSARY が避ける認証画面の語を書かない", () => {
    expect(
      gitGrep(
        String.raw`^test(\.[a-z]+)?\(["'` + "`" + String.raw`].*([^通]ログイン画面|新規登録画面|SignIn 画面)`,
        ":(glob)e2e/*.e2e.ts",
      ),
    ).toEqual([]);
  });
});

describe("共通画面 SPA", () => {
  test("AC-028: web/src の domain の dir に shared/leave-spa の import を書かない", () => {
    expect(
      gitGrep(
        String.raw`shared/leave-spa["']`,
        "web/src/account",
        "web/src/auth",
        "web/src/company",
        "web/src/invitation",
        "web/src/membership",
        "web/src/mfa",
      ),
    ).toEqual([]);
  });

  const ORIGIN = "https://auth.taimei-code.com";
  const ALLOWED_REDIRECT_URL = "https://app.taimei-code.com/dashboard";

  const acceptInvitationRoute = (search: string) =>
    urlToAuthRoute(
      Option.getOrThrowWith(
        fromString(`${ORIGIN}/auth/signup/accept-invitation?invitation_token=tok${search}`),
        () => new Error("URL として読めない"),
      ),
    );

  test.each([
    { label: "戻り先の組が無い", search: "" },
    {
      label: "戻り先が許可の外",
      search: `&service_name=taimei&redirect_url=${encodeURIComponent("https://evil.example.com/")}`,
    },
    { label: "service_name だけ", search: "&service_name=taimei" },
  ])("AC-029: 招待の受諾を $label search で開くと、route の redirect_url は /account", ({ search }) => {
    expect(acceptInvitationRoute(search)).toMatchObject({
      _tag: "AcceptInvitation",
      redirect_url: "/account",
    });
  });

  test("AC-029: 招待の受諾を許可された組の search で開くと、route の redirect_url はその値", () => {
    expect(
      acceptInvitationRoute(
        `&service_name=taimei&redirect_url=${encodeURIComponent(ALLOWED_REDIRECT_URL)}`,
      ),
    ).toMatchObject({ _tag: "AcceptInvitation", redirect_url: ALLOWED_REDIRECT_URL });
  });
});

describe("SDK の依存と公開 interface", () => {
  test("AC-033: SDK の src が process を使うと、SDK の build が落ちる", () => {
    expect(failsOnlyWhenMutated(observed?.sdkBuild, observed?.sdkBuildUsingProcess)).toEqual(
      FAILS_ONLY_WHEN_MUTATED,
    );
  });

  test("AC-034: SDK の公開の型を変えると、SDK の test が落ちる", () => {
    expect(failsOnlyWhenMutated(observed?.sdkTest, observed?.sdkTestWithChangedType)).toEqual(
      FAILS_ONLY_WHEN_MUTATED,
    );
  });

  test("AC-035: .oxlintrc.json に SDK の禁止 package の一覧を書かない", () => {
    expect(
      gitGrep(String.raw`"name": "(next|next/[a-z]+|@connectrpc/connect-web)"`, ".oxlintrc.json"),
    ).toEqual([]);
  });

  test("AC-035: 禁止 package の一覧の写しの test を置かない", () => {
    expect(gitFiles("src/__tests__/sdk-boundary-ban.test.ts")).toEqual([]);
  });
});

describe("検証の前提は、走らせる script が自分で満たす", () => {
  test("AC-036: SDK の dist が無い tree で bun test を走らせると、SDK の dist ができる", () => {
    expect(observed?.sdkDistAfterBunTest).toBe(true);
  });

  test("AC-037: SDK の dist が無い tree で scripts/typecheck.sh を走らせると、SDK の dist ができる", () => {
    expect(observed?.sdkDistAfterTypecheck).toBe(true);
  });

  test("AC-038: ci.yml の shellcheck の対象を dir の列挙で書かない", () => {
    expect(gitGrep(String.raw`shellcheck .*scripts/\*\.sh`, ".github/workflows/ci.yml")).toEqual([]);
  });
});
