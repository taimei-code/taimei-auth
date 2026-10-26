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
  [key: string]: unknown;
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

const KEYS_ALLOWED_TO_DIFFER = ["name", "main", "routes", "workers_dev", "alias"] as const;

const sharedPartOf = (config: WranglerConfig) => {
  const shared: Record<string, unknown> = { ...config };
  for (const key of KEYS_ALLOWED_TO_DIFFER) delete shared[key];
  const assets = config.assets as Record<string, unknown> | undefined;
  return {
    ...shared,
    assets: assets && { ...assets, directory: undefined },
    hyperdrive: config.hyperdrive?.map((binding) => ({ ...binding, id: undefined })),
    vars: Object.keys(config.vars ?? {}).sort(),
  };
};

const keysDifferingFromProduction = (nonProductionConfig: WranglerConfig): string[] => {
  const expected = sharedPartOf(production);
  const actual = sharedPartOf(nonProductionConfig);
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter(
      (key) =>
        JSON.stringify(actual[key as keyof typeof actual]) !==
        JSON.stringify(expected[key as keyof typeof expected]),
    )
    .sort();
};

describe("本番以外の worker の config は、違ってよい key のほかは本番と同じ (互換の日付と DO の migration を写し忘れると、dev と e2e だけが古いまま通る)", () => {
  test("testing/wrangler.jsonc は、name・main・assets の directory・Hyperdrive の id・vars の値・routes・workers_dev・alias のほかは本番と一致する", () => {
    expect(keysDifferingFromProduction(nonProduction)).toEqual([]);
  });

  test.each([
    ["compatibility_date", { compatibility_date: "2099-01-01" }],
    [
      "migrations",
      {
        migrations: [
          { tag: "v1", new_sqlite_classes: ["KvStore"] },
          { tag: "v2", new_sqlite_classes: ["Other"] },
        ],
      },
    ],
  ] as const)("本番以外の %s だけを変えると、食い違いとして報告される", (key, override) => {
    expect(keysDifferingFromProduction({ ...nonProduction, ...override })).toEqual([key]);
  });
});
