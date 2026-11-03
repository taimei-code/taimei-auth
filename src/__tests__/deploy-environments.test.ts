import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  indexOfStepRunning,
  REPO_ROOT,
  readWorkflow,
  workflowFileNames,
} from "./config-invariant-helpers";

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};
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
  env?: Record<string, string>;
  jobs?: Record<string, Job>;
};

const DEPLOY_WORKFLOWS = [
  "deploy.yml",
  "deploy-production-full.yml",
  "deploy-staging-full.yml",
  "iac-drift.yml",
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

const placesWithSecretsInSharedEnv = (entries: readonly [string, Workflow][]) => {
  const deployWorkflows = entries.filter(([name]) => DEPLOY_WORKFLOWS.includes(name));
  const hasSecrets = (env: Record<string, string> | undefined) =>
    JSON.stringify(env ?? {}).includes("secrets.");
  return [
    ...deployWorkflows.filter(([, workflow]) => hasSecrets(workflow.env)).map(([name]) => name),
    ...jobsIn(deployWorkflows)
      .filter(({ job }) => hasSecrets(job.env))
      .map(({ at }) => at),
  ];
};

const deploy = () => readWorkflow<Workflow>("deploy.yml");
const stagingFull = () => readWorkflow<Workflow>("deploy-staging-full.yml");

const PREPARE_STAGING = "./.github/actions/prepare-staging";
const GATE_DEPLOY = "./.github/actions/gate-deploy";

const workflowAndActionTexts = (): [string, string][] => [
  ...workflowFileNames().map((name): [string, string] => [
    name,
    readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8"),
  ]),
  ...readdirSync(join(REPO_ROOT, ".github/actions")).map((name): [string, string] => [
    `actions/${name}`,
    readFileSync(join(REPO_ROOT, ".github/actions", name, "action.yml"), "utf8"),
  ]),
];

const ADOPTION_MARKERS = [/DEPLOY_MODE:\s*adopt\b/, /--adopt\b/];

const workflowsThatAdopt = (texts: readonly [string, string][]) =>
  texts
    .filter(([, text]) => ADOPTION_MARKERS.some((marker) => marker.test(text)))
    .map(([name]) => name);

type ActionInput = { required?: boolean; default?: string };

const gateDeployAction = () =>
  Bun.YAML.parse(
    readFileSync(join(REPO_ROOT, ".github/actions/gate-deploy/action.yml"), "utf8"),
  ) as {
    inputs: Record<string, ActionInput>;
    runs: { steps: (Step & { "working-directory"?: string })[] };
  };

const gateDeployInputs = (workflow: Workflow, jobName: string) =>
  (workflow.jobs?.[jobName]?.steps ?? []).find(({ uses }) => uses === GATE_DEPLOY)?.with;

const prepareStagingSteps = () =>
  (
    Bun.YAML.parse(
      readFileSync(join(REPO_ROOT, ".github/actions/prepare-staging/action.yml"), "utf8"),
    ) as { runs: { steps: Step[] } }
  ).runs.steps;

const indexOfStepUsing = (steps: readonly Step[], action: string) =>
  steps.findIndex(({ uses }) => uses === action);

describe("本番の secret を読める job は、本番の deploy の job に限る (collaborator が 1 人なので、承認者ではなく試験で止める)", () => {
  test("Environment production を持つ job は、本番の deploy・本番を 100% で出す deploy・drift の検出だけ", () => {
    expect(jobsWithEnvironment(workflows(), "production")).toEqual([
      "deploy-production-full.yml#deploy",
      "deploy.yml#deploy",
      "iac-drift.yml#drift",
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
    expect(jobsWithEnvironment(workflows(), "staging")).toEqual([
      "deploy-staging-full.yml#deploy",
      "deploy.yml#staging",
    ]);
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

describe("本番の token は、使う step にだけ渡す (依存の install と build の step に見せない)", () => {
  test("deploy の workflow は、workflow と job の env に secret を置かない", () => {
    expect(placesWithSecretsInSharedEnv(workflows())).toEqual([]);
  });

  test("job の env に secret を置いた deploy の job は、報告される", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow の GitHub Actions の式を文字列のまま置く
    const tokenFromSecrets = "${{ secrets.CLOUDFLARE_API_TOKEN }}";
    const leaking: [string, Workflow] = [
      "iac-drift.yml",
      { jobs: { drift: { environment: "production", env: { TOKEN: tokenFromSecrets } } } },
    ];
    expect(placesWithSecretsInSharedEnv([leaking])).toEqual(["iac-drift.yml#drift"]);
  });

  test("workflow の env に secret を置いた deploy の workflow は、報告される", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow の GitHub Actions の式を文字列のまま置く
    const tokenFromSecrets = "${{ secrets.CLOUDFLARE_API_TOKEN }}";
    const leaking: [string, Workflow] = [
      "iac-drift.yml",
      { env: { TOKEN: tokenFromSecrets }, jobs: { drift: { environment: "production" } } },
    ];
    expect(placesWithSecretsInSharedEnv([leaking])).toEqual(["iac-drift.yml"]);
  });
});

describe("本番の deploy は、staging の deploy が通った時だけ進む", () => {
  test("本番の job は staging の job を待ち、同時に走らない", () => {
    const { staging, deploy: production } = deploy().jobs ?? {};
    expect(production?.needs).toBe("staging");
    expect(production?.concurrency?.group).toBe("deploy-production");
    expect(staging?.concurrency?.group).toBe("deploy-staging");
  });

  test("staging の job は、本番の job と同じ起動の条件を持つ", () => {
    const { staging, deploy: production } = deploy().jobs ?? {};
    expect(staging?.if).toBe(production?.if);
  });

  test("手動の起動に入力欄が無い (staging を飛ばす経路を作らない)", () => {
    expect(deploy().on?.workflow_dispatch?.inputs).toBeUndefined();
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

  test("main の push の staging の job も、0% で出して確かめる deploy の前に同じ準備を使う", () => {
    const steps = deploy().jobs?.staging?.steps ?? [];
    const prepare = indexOfStepUsing(steps, PREPARE_STAGING);
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(prepare).toBeLessThan(indexOfStepUsing(steps, "./.github/actions/gate-deploy"));
  });
});

describe("本番の取り込み (alchemy の adopt) は、人が runbook の手順で 1 回だけ行う", () => {
  test("どの workflow と action も adopt の deploy を走らせない", () => {
    expect(workflowsThatAdopt(workflowAndActionTexts())).toEqual([]);
  });

  test("adopt を書いた workflow を足すと、報告される", () => {
    expect(
      workflowsThatAdopt([
        ...workflowAndActionTexts(),
        ["adopt.yml", "env:\n  DEPLOY_MODE: adopt\n"],
        ["flag.yml", "run: bunx alchemy deploy --adopt\n"],
      ]),
    ).toEqual(["adopt.yml", "flag.yml"]);
  });
});

describe("0% で出して確かめる deploy は、staging と本番で同じ action を使い、差は入力の値だけ", () => {
  test("action は alchemy を入力の dir (既定は checkout) で起動し、smoke の方式を入力で受け、Access の入力は必須にしない", () => {
    const action = gateDeployAction();
    const alchemy = action.runs.steps.find(({ run = "" }) => run.includes("alchemy deploy"));
    const smoke = action.runs.steps.find(({ run = "" }) => run.includes("preview-smoke.sh"));
    expect({
      directory: {
        required: action.inputs.directory?.required,
        default: action.inputs.directory?.default,
      },
      alchemyDirectory: alchemy?.["working-directory"],
      smokeArgument: smoke?.run?.trimEnd().endsWith('"$SMOKE"'),
      smokeEnv: smoke?.env?.SMOKE,
      accessRequired: [
        action.inputs["access-client-id"]?.required,
        action.inputs["access-client-secret"]?.required,
      ],
    }).toEqual({
      directory: { required: false, default: "." },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: action の GitHub Actions の式を文字列のまま比べる
      alchemyDirectory: "${{ inputs.directory }}",
      smokeArgument: true,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: action の GitHub Actions の式を文字列のまま比べる
      smokeEnv: "${{ inputs.smoke }}",
      accessRequired: [false, false],
    });
  });

  test("staging の 2 つの deploy の経路は Access の service token つきで smoke する", () => {
    expect([
      gateDeployInputs(deploy(), "staging")?.smoke,
      stagingFull().jobs?.deploy?.steps?.find(({ run = "" }) => run.includes("preview-smoke.sh"))
        ?.run,
    ]).toEqual(["access", expect.stringMatching(/ access$/)]);
  });
});
