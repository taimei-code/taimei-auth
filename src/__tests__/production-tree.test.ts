import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./config-invariant-helpers";
import { grepFiles } from "./source-scan";

const PRODUCTION_TREE_SCRIPT = "scripts/build-production-tree.sh";
// biome-ignore lint/suspicious/noTemplateCurlyInString: workflow の GitHub Actions の式を文字列のまま比べる
const PRODUCTION_TREE_DIR = "${{ runner.temp }}/production-tree";
const EXCLUSION_LIST_DECLARATION = "EXCLUDED_FROM_PRODUCTION=\\(";
const NON_PRODUCTION_DIRS = ["db/testing", "testing", "web/non-production"];

type Step = { name?: string; run?: string; "working-directory"?: string };
type Workflow = {
  on?: Record<string, unknown>;
  concurrency?: { group?: string };
  jobs?: Record<string, { if?: string; steps?: Step[] }>;
};

const readWorkflow = (name: string): Workflow =>
  Bun.YAML.parse(readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8")) as Workflow;

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

const deployViolations = (workflow: Workflow): string[] => [
  ...(buildsProductionTree(workflow) ? [] : ["does not build the production tree"]),
  ...(runsOnlyInProductionTree(workflow, "wrangler versions upload --tag")
    ? []
    : ["uploads outside the production tree"]),
  ...(stepsRunning(workflow, "bun run build:web").length === 0
    ? []
    : ["builds the web in the checkout"]),
];

const ONLY_ON_MAIN = "github.ref == 'refs/heads/main'";

const migrationViolations = (workflow: Workflow): string[] => [
  ...(Object.values(workflow.jobs ?? {}).every((job) => job.if === ONLY_ON_MAIN)
    ? []
    : ["can deploy a branch other than main"]),
  ...(buildsProductionTree(workflow) ? [] : ["does not build the production tree"]),
  ...(runsOnlyInProductionTree(workflow, "wrangler deploy")
    ? []
    : ["deploys outside the production tree"]),
  ...(Object.keys(workflow.on ?? {}).join() === "workflow_dispatch"
    ? []
    : ["starts without a person"]),
  ...(workflow.concurrency?.group === "deploy-production"
    ? []
    : ["can interleave with deploy.yml"]),
];

const exclusionList = (): string[] => {
  const script = readFileSync(join(REPO_ROOT, PRODUCTION_TREE_SCRIPT), "utf8");
  const match = script.match(/EXCLUDED_FROM_PRODUCTION=\(([^)]*)\)/);
  return (match?.[1] ?? "").split(/\s+/).filter(Boolean).sort();
};

const ci = readWorkflow("ci.yml");
const deploy = readWorkflow("deploy.yml");
const migration = readWorkflow("deploy-durable-object-migration.yml");

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

  test("deploy は除外した tree で build して upload し、checkout では web を build しない", () => {
    expect(deployViolations(deploy)).toEqual([]);
  });

  test("DO の migration は人が起動し、deploy と交互に走らず、除外した tree から deploy する", () => {
    expect(migrationViolations(migration)).toEqual([]);
  });

  test.each([
    ["script を呼ばない", { jobs: {} }, "does not build the production tree"],
    [
      "checkout で upload する",
      {
        jobs: {
          deploy: {
            steps: [
              { run: `bash ${PRODUCTION_TREE_SCRIPT} "${PRODUCTION_TREE_DIR}"` },
              { run: 'bunx wrangler versions upload --tag "ci"' },
            ],
          },
        },
      },
      "uploads outside the production tree",
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
      { ...migration, on: { workflow_dispatch: null, push: null } },
      "starts without a person",
    ],
    [
      "deploy.yml と別の group で走る",
      { ...migration, concurrency: { group: "migration" } },
      "can interleave with deploy.yml",
    ],
    [
      "main 以外の branch でも走る",
      { ...migration, jobs: { migrate: { steps: [] } } },
      "can deploy a branch other than main",
    ],
  ] as const)("migration の workflow が%sと違反になる", (_, workflow, violation) => {
    expect(migrationViolations(workflow as Workflow)).toContain(violation);
  });
});
