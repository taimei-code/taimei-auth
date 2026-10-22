import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { REPO_ROOT } from "./config-invariant-helpers";

const CHECK_SCRIPT = join(REPO_ROOT, "scripts/check-production-bundle.sh");
const WORKER_WITH_TESTING_API = `app.post("${TESTING_PATH}/signed-in-users")`;
const WORKER_WITHOUT_TESTING_API = 'app.get("/health")';

const scriptVariable = (name: string) =>
  readFileSync(CHECK_SCRIPT, "utf8").match(new RegExp(`^${name}="([^"]*)"$`, "m"))?.[1];

const devHomeSignInPath = scriptVariable("dev_home_sign_in_path");

const bundleDirs: string[] = [];

afterEach(() => {
  for (const dir of bundleDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const bundleDir = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "production-bundle-"));
  bundleDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
};

const runBundleCheck = (...args: string[]) => {
  const result = Bun.spawnSync(["bash", CHECK_SCRIPT, ...args]);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

describe("本番の bundle の検査は、試験 API の path か開発者ホームのログインの送り先を含む bundle で deploy を止める", () => {
  test("検査する path は、試験 API の route と SDK が使う TESTING_PATH と同じ", () => {
    expect(scriptVariable("testing_api_path")).toBe(TESTING_PATH);
  });

  test("worker.js が試験 API の path を含むと、0 以外で終わる", () => {
    const dir = bundleDir({ "worker.js": WORKER_WITH_TESTING_API });

    expect(runBundleCheck(dir).exitCode).not.toBe(0);
  });

  test("試験 API の path を含む file の path を stdout に出す", () => {
    const dir = bundleDir({ "worker.js": WORKER_WITH_TESTING_API });

    expect(runBundleCheck(dir).stdout).toBe(`${join(dir, "worker.js")}\n`);
  });

  test("worker.js が開発者ホームのログインの送り先を含むと、0 以外で終わり、その file の path を stdout に出す", () => {
    const dir = bundleDir({ "worker.js": `app.post("${devHomeSignInPath}")` });

    expect(devHomeSignInPath).toBeDefined();
    const result = runBundleCheck(dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe(`${join(dir, "worker.js")}\n`);
  });

  test("worker.js 以外の module が試験 API の path を含むと、0 以外で終わる", () => {
    const dir = bundleDir({
      "worker.js": 'import "./extra.mjs";',
      "extra.mjs": `export const path = "${TESTING_PATH}";`,
    });

    expect(runBundleCheck(dir).exitCode).not.toBe(0);
  });

  test("試験 API の path を含まない bundle は、0 で終わり OK を出す", () => {
    const dir = bundleDir({
      "worker.js": WORKER_WITHOUT_TESTING_API,
      "worker.js.map": '{"sources":["src/worker.ts"]}',
      "README.md": "wrangler output",
    });

    expect(runBundleCheck(dir)).toMatchObject({
      exitCode: 0,
      stdout: `OK: production bundle has no ${TESTING_PATH} or ${devHomeSignInPath}\n`,
    });
  });

  test("実行されない source map だけが試験 API の path を含む bundle は、0 で終わる", () => {
    const dir = bundleDir({
      "worker.js": WORKER_WITHOUT_TESTING_API,
      "worker.js.map": `{"sourcesContent":["${TESTING_PATH}"]}`,
    });

    expect(runBundleCheck(dir).exitCode).toBe(0);
  });
});

describe("本番の bundle の検査は、検査できない時に通さない", () => {
  test("bundle の dir を渡さないと、使い方を出して 0 以外で終わる", () => {
    const result = runBundleCheck();

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("usage:");
  });

  test("worker.js が無い dir は、0 以外で終わる", () => {
    const result = runBundleCheck(bundleDir({ "README.md": "wrangler output" }));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("worker.js is missing or empty");
  });

  test("worker.js が 0 byte の dir は、0 以外で終わる", () => {
    expect(runBundleCheck(bundleDir({ "worker.js": "" })).exitCode).not.toBe(0);
  });

  test("読めない file を含む dir は、0 以外で終わる", () => {
    const dir = bundleDir({ "worker.js": WORKER_WITHOUT_TESTING_API, "chunk.js": "" });
    chmodSync(join(dir, "chunk.js"), 0o000);

    expect(runBundleCheck(dir).exitCode).not.toBe(0);
  });
});

type WorkflowStep = { readonly run?: string };

const deploySteps = (): WorkflowStep[] => {
  const workflow = Bun.YAML.parse(
    readFileSync(join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf8"),
  ) as { jobs: { deploy: { steps: WorkflowStep[] } } };
  return workflow.jobs.deploy.steps;
};

const DRY_RUN_OUTDIR = /wrangler versions upload --dry-run --outdir (\S+)/;
const CHECKED_DIR = /scripts\/check-production-bundle\.sh (\S+)/;

const isBundleCheckStep = ({ run = "" }: WorkflowStep) => {
  const outdir = run.match(DRY_RUN_OUTDIR)?.[1];
  return outdir !== undefined && run.match(CHECKED_DIR)?.[1] === outdir;
};

const indexOfStepRunning = (steps: readonly WorkflowStep[], fragment: string) =>
  steps.findIndex(({ run = "" }) => run.includes(fragment));

describe("deploy の workflow は、本番の状態を変える前に本番の bundle を検査する", () => {
  test("dry-run で出した dir をそのまま検査する step がちょうど 1 つある", () => {
    expect(deploySteps().filter(isBundleCheckStep)).toHaveLength(1);
  });

  test("検査の step は web の build の後、migrations と upload の前にある", () => {
    const steps = deploySteps();
    const checkStep = steps.findIndex(isBundleCheckStep);
    const webBuildStep = indexOfStepRunning(steps, "bun run build:web");

    expect(webBuildStep).toBeGreaterThanOrEqual(0);
    expect(checkStep).toBeGreaterThan(webBuildStep);
    expect(checkStep).toBeLessThan(indexOfStepRunning(steps, "db:migrate"));
    expect(checkStep).toBeLessThan(indexOfStepRunning(steps, "wrangler versions upload --tag"));
  });

  test("検査の step は name と run だけを持ち、失敗を無視する設定・実行の条件・env を持たない", () => {
    expect(
      deploySteps()
        .filter(isBundleCheckStep)
        .map((step) => Object.keys(step).sort()),
    ).toEqual([["name", "run"]]);
  });

  test("検査の step の run は secret を参照しない", () => {
    expect(
      deploySteps()
        .filter(isBundleCheckStep)
        .map(({ run = "" }) => run.includes("secrets.")),
    ).toEqual([false]);
  });
});
