import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SECRET_BINDING_NAMES } from "../secret-bindings";
import {
  DURABLE_OBJECT_BINDINGS,
  expectedBindings,
  parseAccountId,
  parseDeployMode,
  parseStage,
  STAGES,
  STATE_STORE_WORKER_NAME,
  type StageConfig,
  WORKER_RUNTIME,
} from "../../infra/stages";
import { ALLOWED_REDIRECT_HOST_PATTERNS } from "../../testing/redirect-hosts";
import { parseJsonc, REPO_ROOT, symmetricDifference } from "./config-invariant-helpers";

type WranglerConfig = {
  name: string;
  compatibility_date: string;
  compatibility_flags: string[];
  assets: { run_worker_first: boolean; not_found_handling: string };
  vars: Record<string, string>;
  durable_objects: { bindings: { name: string; class_name: string }[] };
};

const production = parseJsonc(
  readFileSync(join(REPO_ROOT, "wrangler.jsonc"), "utf8"),
) as WranglerConfig;

const stages: [string, StageConfig][] = Object.entries(STAGES);

const secretTypes = () =>
  expectedBindings("production")
    .filter(({ name }) => (SECRET_BINDING_NAMES as readonly string[]).includes(name))
    .map(({ type }) => type);

const varKeysMissingOrExtra = (vars: Record<string, string>) =>
  symmetricDifference(Object.keys(vars), Object.keys(production.vars));

const durableObjectBindingsOf = (bindings: Record<string, string>) =>
  Object.entries(bindings).map(([name, className]) => ({ name, class_name: className }));

const hostsIn = ({ vars }: StageConfig) =>
  [vars.AUTH_SERVICE_URL, ...vars.AUTH_TRUSTED_ORIGINS.split(",")].map((url) => new URL(url).host);

const allowedAsRedirect = (host: string) =>
  Object.values(ALLOWED_REDIRECT_HOST_PATTERNS).some((pattern) => pattern.test(host));

describe("IaC の stage の表は、本番の wrangler.jsonc とずれない", () => {
  test("stage は staging と production", () => {
    expect(Object.keys(STAGES)).toEqual(["staging", "production"]);
  });

  test("staging の vars の key は wrangler.jsonc の vars の key と同じ", () => {
    expect(varKeysMissingOrExtra(STAGES.staging.vars)).toEqual([]);
  });

  test("production の vars は wrangler.jsonc の vars と key も値も同じ (local の開発と本番の定義がずれない)", () => {
    expect(production.vars).toEqual({ ...STAGES.production.vars });
  });

  test("production は今の本番の Worker と Hyperdrive を名前で指す (作り直さずに取り込む)", () => {
    expect({
      workerName: STAGES.production.workerName,
      hyperdriveName: STAGES.production.hyperdriveName,
    }).toEqual({ workerName: "taimei-auth", hyperdriveName: "taimei-auth-prod" });
  });

  test("production は custom domain で配り、staging は workers.dev を Access の後ろで配る", () => {
    expect([STAGES.production.servedAt, STAGES.staging.servedAt]).toEqual([
      { kind: "customDomain", domain: "auth.taimei-code.com" },
      { kind: "workersDevBehindAccess" },
    ]);
  });

  test.each(stages)("%s の secret の名前は、Worker が解く名前の一覧にある", (_, stage) => {
    expect(stage.secrets.filter((name) => !SECRET_BINDING_NAMES.includes(name))).toEqual([]);
  });

  test("production は、Worker が解く secret をすべて持つ", () => {
    expect(symmetricDifference([...STAGES.production.secrets], [...SECRET_BINDING_NAMES])).toEqual(
      [],
    );
  });

  test("本番の secret は、すべて Secrets Store の binding で期待する", () => {
    expect([...new Set(secretTypes())]).toEqual(["secrets_store_secret"]);
  });

  test("vars の key を 1 つ外すと、ずれとして報告される", () => {
    const { APP_ENV: _, ...withoutAppEnv } = production.vars;
    expect(varKeysMissingOrExtra(withoutAppEnv)).toEqual(["APP_ENV"]);
  });

  test("Durable Object の binding は wrangler.jsonc と同じ (alchemy は binding を外すとデータごと namespace を消し、plan には update としか出さない)", () => {
    expect(durableObjectBindingsOf(DURABLE_OBJECT_BINDINGS)).toEqual(
      production.durable_objects.bindings,
    );
  });

  test("互換の日付と flag、assets の配り方は wrangler.jsonc と同じ (本番の日付を上げた時に staging だけ古いまま動かない)", () => {
    expect({
      compatibility_date: production.compatibility_date,
      compatibility_flags: production.compatibility_flags,
      run_worker_first: production.assets.run_worker_first,
      not_found_handling: production.assets.not_found_handling,
    }).toEqual({
      compatibility_date: WORKER_RUNTIME.compatibility.date,
      compatibility_flags: [...WORKER_RUNTIME.compatibility.flags],
      run_worker_first: WORKER_RUNTIME.assets.runWorkerFirst,
      not_found_handling: WORKER_RUNTIME.assets.notFoundHandling,
    });
  });

  test("staging の Worker の名前は本番の Worker の名前と違う", () => {
    expect(STAGES.staging.workerName).not.toBe(production.name);
  });

  test("staging の auth と app の host は、本番以外の redirect 先に許される", () => {
    expect(hostsIn(STAGES.staging).filter((host) => !allowedAsRedirect(host))).toEqual([]);
  });
});

describe("IaC の CLI の入力は、表に無い値で何も作らずに止まる", () => {
  test.each(["Production", "", "Staging"])("stage %p は表に無いので失敗する", (name) => {
    expect(() => parseStage(name)).toThrow();
  });

  test.each(["staging", "production"])("stage %s は通る", (name) => {
    expect(parseStage(name)).toBe(name);
  });

  test.each([undefined, "", "canary", "FULL", "adopt"])("deploy の方式 %p は失敗する", (value) => {
    expect(() => parseDeployMode(value)).toThrow();
  });

  test.each(["gate", "full"])("deploy の方式 %s は通る", (value) => {
    expect(parseDeployMode(value)).toBe(value);
  });

  test.each([
    undefined,
    "",
  ])("アカウントの ID %p は失敗する (Access の開発者の policy をどのアカウントのメンバーにも絞れない)", (value) => {
    expect(() => parseAccountId(value)).toThrow();
  });

  test("アカウントの ID は渡した値のまま通る", () => {
    expect(parseAccountId("0123456789abcdef0123456789abcdef")).toBe(
      "0123456789abcdef0123456789abcdef",
    );
  });
});

test("state の置き場の Worker 名は、alchemy beta.84 が name の taimei-auth から作った名前のままにする (変えると既存の state を見失い、全資源を作り直そうとする)", () => {
  expect(STATE_STORE_WORKER_NAME).toBe("alchemy-state-store-taimei-auth");
});
