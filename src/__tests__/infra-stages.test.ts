import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DURABLE_OBJECT_BINDINGS,
  parseDeployMode,
  parseStage,
  STAGES,
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
) as unknown as WranglerConfig;

const stages: [string, StageConfig][] = Object.entries(STAGES);

const varKeysMissingOrExtra = (vars: Record<string, string>) =>
  symmetricDifference(Object.keys(vars), Object.keys(production.vars));

const durableObjectBindingsOf = (bindings: Record<string, string>) =>
  Object.entries(bindings).map(([name, className]) => ({ name, class_name: className }));

const hostsIn = ({ vars }: StageConfig) =>
  [vars.AUTH_SERVICE_URL, ...vars.AUTH_TRUSTED_ORIGINS.split(",")].map((url) => new URL(url).host);

const allowedAsRedirect = (host: string) =>
  Object.values(ALLOWED_REDIRECT_HOST_PATTERNS).some((pattern) => pattern.test(host));

describe("IaC の stage の表は、本番の wrangler.jsonc とずれない", () => {
  test("stage は staging だけ", () => {
    expect(Object.keys(STAGES)).toEqual(["staging"]);
  });

  test.each(stages)("%s の vars の key は wrangler.jsonc の vars の key と同じ", (_, stage) => {
    expect(varKeysMissingOrExtra(stage.vars)).toEqual([]);
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

  test.each(stages)("%s の Worker の名前は本番の Worker の名前と違う", (_, stage) => {
    expect(stage.workerName).not.toBe(production.name);
  });

  test.each(
    stages,
  )("%s の auth と app の host は、本番以外の redirect 先に許される", (_, stage) => {
    expect(hostsIn(stage).filter((host) => !allowedAsRedirect(host))).toEqual([]);
  });
});

describe("IaC の CLI の入力は、表に無い値で何も作らずに止まる", () => {
  test.each(["production", "", "Staging"])("stage %p は表に無いので失敗する", (name) => {
    expect(() => parseStage(name)).toThrow();
  });

  test("stage staging は通る", () => {
    expect(parseStage("staging")).toBe("staging");
  });

  test.each([undefined, "", "canary", "FULL"])("deploy の方式 %p は失敗する", (value) => {
    expect(() => parseDeployMode(value)).toThrow();
  });

  test.each(["gate", "full"])("deploy の方式 %s は通る", (value) => {
    expect(parseDeployMode(value)).toBe(value);
  });
});
