import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc, REPO_ROOT } from "./config-invariant-helpers";

type WranglerConfig = {
  name?: string;
  routes?: unknown[];
  workers_dev?: boolean;
  hyperdrive?: { id: string }[];
  vars?: Record<string, string>;
};

const readWranglerConfig = (path: string): WranglerConfig =>
  parseJsonc(readFileSync(join(REPO_ROOT, path), "utf8")) as unknown as WranglerConfig;

const hyperdriveIds = (config: WranglerConfig): string[] =>
  (config.hyperdrive ?? []).map((binding) => binding.id);

const productionValuesIn = (
  nonProduction: WranglerConfig,
  production: WranglerConfig,
): string[] => [
  ...(nonProduction.name === production.name ? ["name"] : []),
  ...(nonProduction.routes !== undefined ? ["routes"] : []),
  ...(nonProduction.workers_dev !== false ? ["workers_dev"] : []),
  ...hyperdriveIds(nonProduction)
    .filter((id) => hyperdriveIds(production).includes(id))
    .map(() => "hyperdrive"),
  ...Object.entries(nonProduction.vars ?? {})
    .filter(([, value]) => value !== "")
    .map(([key]) => `vars.${key}`),
];

const production = readWranglerConfig("wrangler.jsonc");
const nonProduction = readWranglerConfig("testing/wrangler.jsonc");

describe("本番以外の worker の config は、誤って deploy しても本番の name・route・DB・vars に載らない", () => {
  test("testing/wrangler.jsonc は本番の値を 1 つも持たない", () => {
    expect(productionValuesIn(nonProduction, production)).toEqual([]);
  });

  test.each([
    ["name", { name: production.name }],
    ["routes", { routes: production.routes ?? [] }],
    ["workers_dev", { workers_dev: true }],
    ["hyperdrive", { hyperdrive: production.hyperdrive }],
    ["vars.APP_ENV", { vars: { ...nonProduction.vars, APP_ENV: "production" } }],
  ] as const)("%s を本番の値にすると違反になる", (violation, override) => {
    expect(productionValuesIn({ ...nonProduction, ...override }, production)).toContain(violation);
  });
});
