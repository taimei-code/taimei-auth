import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  indexOfStepRunning,
  REPO_ROOT,
  readWorkflow,
  workflowFileNames,
} from "./config-invariant-helpers";

type Step = { name?: string; run?: string; uses?: string; env?: Record<string, string> };
type Job = {
  if?: string;
  environment?: string;
  needs?: string | string[];
  concurrency?: { group?: string };
  env?: Record<string, string>;
  steps?: Step[];
};
type Workflow = {
  on?: Record<string, { inputs?: unknown } | null>;
  jobs?: Record<string, Job>;
};

const DEPLOY_WORKFLOWS = [
  "deploy.yml",
  "deploy-durable-object-migration.yml",
  "deploy-staging-full.yml",
];

const workflows = (): [string, Workflow][] =>
  workflowFileNames().map((name) => [name, readWorkflow<Workflow>(name)]);

const jobsIn = (entries: readonly [string, Workflow][]) =>
  entries.flatMap(([name, workflow]) =>
    Object.entries(workflow.jobs ?? {}).map(([jobName, job]) => ({
      at: `${name}#${jobName}`,
      job,
    })),
  );

const jobsWithEnvironment = (entries: readonly [string, Workflow][], environment: string) =>
  jobsIn(entries)
    .filter(({ job }) => job.environment === environment)
    .map(({ at }) => at)
    .sort();

const referencesSecrets = (job: Job) => JSON.stringify(job).includes("secrets.");

const jobsUsingSecretsWithoutEnvironment = (entries: readonly [string, Workflow][]) =>
  jobsIn(entries.filter(([name]) => DEPLOY_WORKFLOWS.includes(name)))
    .filter(({ job }) => referencesSecrets(job) && job.environment === undefined)
    .map(({ at }) => at);

const deploy = () => readWorkflow<Workflow>("deploy.yml");
const stagingFull = () => readWorkflow<Workflow>("deploy-staging-full.yml");

const PREPARE_STAGING = "./.github/actions/prepare-staging";

const prepareStagingSteps = () =>
  (
    Bun.YAML.parse(
      readFileSync(join(REPO_ROOT, ".github/actions/prepare-staging/action.yml"), "utf8"),
    ) as { runs: { steps: Step[] } }
  ).runs.steps;

const indexOfStepUsing = (steps: readonly Step[], action: string) =>
  steps.findIndex(({ uses }) => uses === action);

describe("本番の secret を読める job は、本番の deploy の job に限る (collaborator が 1 人なので、承認者ではなく試験で止める)", () => {
  test("Environment production を持つ job は、本番の deploy と Durable Object の migration だけ", () => {
    expect(jobsWithEnvironment(workflows(), "production")).toEqual([
      "deploy-durable-object-migration.yml#migrate",
      "deploy.yml#deploy",
    ]);
  });

  test("ほかの job に Environment production を足すと、報告される", () => {
    const added: [string, Workflow] = [
      "ci.yml",
      { jobs: { check: { environment: "production", steps: [] } } },
    ];
    expect(jobsWithEnvironment([...workflows(), added], "production")).toContain("ci.yml#check");
  });

  test("Environment staging を持つ job は、staging の deploy だけ", () => {
    expect(jobsWithEnvironment(workflows(), "staging")).toEqual(["deploy-staging-full.yml#deploy"]);
  });

  test("deploy の workflow で secret を参照する job は、どれも Environment を持つ (repo 全体の secret を読まない)", () => {
    expect(jobsUsingSecretsWithoutEnvironment(workflows())).toEqual([]);
  });

  test("Environment を持たずに secret を参照する deploy の job は、報告される", () => {
    const leaking: [string, Workflow] = [
      "deploy.yml",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow の GitHub Actions の式を文字列のまま置く
      { jobs: { leak: { steps: [{ run: "echo ${{ secrets.DATABASE_URL }}" }] } } },
    ];
    expect(jobsUsingSecretsWithoutEnvironment([leaking])).toEqual(["deploy.yml#leak"]);
  });

  test("Environment を持たずに job の env で secret を参照する deploy の job も、報告される", () => {
    const leaking: [string, Workflow] = [
      "deploy.yml",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow の GitHub Actions の式を文字列のまま置く
      { jobs: { leak: { env: { TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}" }, steps: [] } } },
    ];
    expect(jobsUsingSecretsWithoutEnvironment([leaking])).toEqual(["deploy.yml#leak"]);
  });
});

describe("本番の deploy は、DO の migration と同時に走らない", () => {
  test("本番の job は、DO の migration と同じ concurrency の group を持つ", () => {
    expect(deploy().jobs?.deploy?.concurrency?.group).toBe("deploy-production");
  });
});

describe("staging を 100% で出す手動の workflow は、本番の DO の migration と同じ形で、staging の deploy と交互に走らない", () => {
  test("人が main から起動し、staging の deploy と同じ concurrency の group を持つ", () => {
    const workflow = stagingFull();
    expect(Object.keys(workflow.on ?? {})).toEqual(["workflow_dispatch"]);
    expect(workflow.jobs?.deploy?.if).toBe("github.ref == 'refs/heads/main'");
    expect(workflow.jobs?.deploy?.concurrency?.group).toBe("deploy-staging");
  });

  test("staging の準備、100% の deploy、Access つきの smoke の順に走る", () => {
    const steps = stagingFull().jobs?.deploy?.steps ?? [];
    const order = [
      indexOfStepUsing(steps, PREPARE_STAGING),
      indexOfStepRunning(steps, "alchemy deploy infra/alchemy.run.ts --stage staging"),
      indexOfStepRunning(steps, "scripts/preview-smoke.sh"),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("staging の準備は、2 つの deploy の経路が同じ手順を使う", () => {
  test("staging の準備は、bundle の build、印の表の確認、migrate、本番以外の表の準備の順に走る (印の無い DB には migrate も流さない)", () => {
    const steps = prepareStagingSteps();
    const order = [
      "scripts/build-staging-bundle.sh",
      "testing/check-staging-database.ts",
      "db:migrate",
      "testing/prepare-staging-database.ts",
    ].map((fragment) => indexOfStepRunning(steps, fragment));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
