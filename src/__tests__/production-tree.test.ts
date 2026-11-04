import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NON_PRODUCTION_DIRS,
  REPO_ROOT,
  readWorkflow as readWorkflowAs,
} from "./config-invariant-helpers";
import { grepFiles } from "./source-scan";

const PRODUCTION_TREE_SCRIPT = "scripts/build-production-tree.sh";
// biome-ignore lint/suspicious/noTemplateCurlyInString: workflow の GitHub Actions の式を文字列のまま比べる
const PRODUCTION_TREE_DIR = "${{ runner.temp }}/production-tree";
const EXCLUSION_LIST_DECLARATION = "EXCLUDED_FROM_PRODUCTION=\\(";

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  "working-directory"?: string;
};
type Workflow = {
  on?: Record<string, unknown>;
  concurrency?: { group?: string };
  jobs?: Record<string, { if?: string; steps?: Step[] }>;
};

const GATE_DEPLOY = "./.github/actions/gate-deploy";

const readWorkflow = (name: string) => readWorkflowAs<Workflow>(name);

const stepsOf = (workflow: Workflow): Step[] =>
  Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);

const stepsRunning = (workflow: Workflow, command: string): Step[] =>
  stepsOf(workflow).filter((step) => step.run?.includes(command));

const buildsProductionTree = (workflow: Workflow): boolean =>
  stepsRunning(workflow, `${PRODUCTION_TREE_SCRIPT} "${PRODUCTION_TREE_DIR}"`).length === 1;

const runsOnlyInProductionTree = (workflow: Workflow, command: string): boolean => {
  const steps = stepsRunning(workflow, command);
  return (
    steps.length > 0 && steps.every((step) => step["working-directory"] === PRODUCTION_TREE_DIR)
  );
};

const gatesProductionFromTree = (workflow: Workflow): boolean => {
  const gates = (workflow.jobs?.deploy?.steps ?? []).filter(({ uses }) => uses === GATE_DEPLOY);
  return (
    gates.length === 1 &&
    gates.every(
      (step) =>
        step.with?.stage === "production" &&
        step.with?.directory === PRODUCTION_TREE_DIR &&
        step.with?.smoke === "public",
    )
  );
};

const ONLY_PUSHES_TO_MAIN_OF_THIS_REPOSITORY =
  "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_repository.full_name == github.repository)";

const deployViolations = (workflow: Workflow): string[] => [
  ...(Object.values(workflow.jobs ?? {}).every(
    (job) => job.if === ONLY_PUSHES_TO_MAIN_OF_THIS_REPOSITORY,
  )
    ? []
    : ["can deploy a commit that was not pushed to main of this repository"]),
  ...(buildsProductionTree(workflow) ? [] : ["does not build the production tree"]),
  ...(gatesProductionFromTree(workflow)
    ? []
    : ["does not gate production from the production tree"]),
  ...(stepsRunning(workflow, "bun run build:web").length === 0
    ? []
    : ["builds the web in the checkout"]),
];

const ONLY_ON_MAIN = "github.ref == 'refs/heads/main'";

const PRODUCTION_ALCHEMY_DEPLOY = "alchemy deploy infra/alchemy.run.ts --stage production";

const deploysAtFull = (workflow: Workflow): boolean =>
  stepsRunning(workflow, PRODUCTION_ALCHEMY_DEPLOY).every(
    (step) => step.env?.DEPLOY_MODE === "full",
  );

const failedChecks = (checks: readonly (readonly [boolean, string])[]): string[] =>
  checks.filter(([passes]) => !passes).map(([, violation]) => violation);

const fullDeployViolations = (workflow: Workflow): string[] =>
  failedChecks([
    [
      Object.values(workflow.jobs ?? {}).every((job) => job.if === ONLY_ON_MAIN),
      "can deploy a branch other than main",
    ],
    [buildsProductionTree(workflow), "does not build the production tree"],
    [
      runsOnlyInProductionTree(workflow, PRODUCTION_ALCHEMY_DEPLOY),
      "deploys outside the production tree",
    ],
    [deploysAtFull(workflow), "does not deploy at 100%"],
    [Object.keys(workflow.on ?? {}).join() === "workflow_dispatch", "starts without a person"],
    [workflow.concurrency?.group === "deploy-production", "can interleave with deploy.yml"],
  ]);

const exclusionList = (): string[] => {
  const script = readFileSync(join(REPO_ROOT, PRODUCTION_TREE_SCRIPT), "utf8");
  const match = script.match(/EXCLUDED_FROM_PRODUCTION=\(([^)]*)\)/);
  return (match?.[1] ?? "").split(/\s+/).filter(Boolean).sort();
};

const ci = readWorkflow("ci.yml");
const deploy = readWorkflow("deploy.yml");
const full = readWorkflow("deploy-production-full.yml");
const drift = readWorkflow("iac-drift.yml");

describe("本番は本番以外の code が無い tree からだけ build する", () => {
  test("除外する dir の一覧は 1 つの script にだけあり、本番以外の dir を 3 つとも含む", () => {
    expect(
      grepFiles(EXCLUSION_LIST_DECLARATION, ["scripts", ".github"], { include: ["*.sh", "*.yml"] }),
    ).toEqual([PRODUCTION_TREE_SCRIPT]);
    expect(exclusionList()).toEqual(NON_PRODUCTION_DIRS);
  });

  test("PR の CI は除外した tree で本番を build する", () => {
    expect(buildsProductionTree(ci)).toBe(true);
  });

  test("deploy は、この repository の main への push の CI と、main からの手動の起動だけで走る", () => {
    expect(deployViolations(deploy)).not.toContain(
      "can deploy a commit that was not pushed to main of this repository",
    );
  });

  test("deploy は除外した tree で build して upload し、checkout では web を build しない", () => {
    expect(deployViolations(deploy)).toEqual([]);
  });

  test("本番を 100% で出す workflow (DO の追加・改名・削除) は人が main から起動し、deploy と交互に走らず、除外した tree の中で alchemy を起動する", () => {
    expect(fullDeployViolations(full)).toEqual([]);
  });

  test("drift の検出は、毎日の schedule と人の起動で main から走り、除外した tree の中で alchemy と Worker の設定の比較を起動する", () => {
    expect({
      triggers: Object.keys(drift.on ?? {}).sort(),
      onlyOnMain: Object.values(drift.jobs ?? {}).every((job) => job.if === ONLY_ON_MAIN),
      buildsTree: buildsProductionTree(drift),
      driftInTree: runsOnlyInProductionTree(drift, "infra/check-drift.ts production"),
      workerInTree: runsOnlyInProductionTree(drift, "infra/check-worker.ts production"),
    }).toEqual({
      triggers: ["schedule", "workflow_dispatch"],
      onlyOnMain: true,
      buildsTree: true,
      driftInTree: true,
      workerInTree: true,
    });
  });

  test.each([
    ["script を呼ばない", { jobs: {} }, "does not build the production tree"],
    [
      "checkout から gate する",
      {
        jobs: {
          deploy: {
            steps: [
              { run: `bash ${PRODUCTION_TREE_SCRIPT} "${PRODUCTION_TREE_DIR}"` },
              { uses: GATE_DEPLOY, with: { stage: "production", directory: ".", smoke: "public" } },
            ],
          },
        },
      },
      "does not gate production from the production tree",
    ],
    [
      "CI の成功だけを条件にする",
      { jobs: { deploy: { if: "github.event.workflow_run.conclusion == 'success'", steps: [] } } },
      "can deploy a commit that was not pushed to main of this repository",
    ],
    [
      "checkout で web を build する",
      { jobs: { deploy: { steps: [{ run: "bun run build:web" }] } } },
      "builds the web in the checkout",
    ],
  ] as const)("deploy が%sと違反になる", (_, workflow, violation) => {
    expect(deployViolations(workflow as Workflow)).toContain(violation);
  });

  test.each([
    [
      "push でも起動する",
      { ...full, on: { workflow_dispatch: null, push: null } },
      "starts without a person",
    ],
    [
      "deploy.yml と別の group で走る",
      { ...full, concurrency: { group: "full" } },
      "can interleave with deploy.yml",
    ],
    [
      "main 以外の branch でも走る",
      { ...full, jobs: { deploy: { steps: [] } } },
      "can deploy a branch other than main",
    ],
  ] as const)("100% の deploy の workflow が%sと違反になる", (_, workflow, violation) => {
    expect(fullDeployViolations(workflow as Workflow)).toContain(violation);
  });
});
