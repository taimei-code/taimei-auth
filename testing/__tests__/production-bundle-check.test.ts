import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import {
  NON_PRODUCTION_ENTRY_NAME,
  NON_PRODUCTION_SCRIPT_FILE,
  NON_PRODUCTION_STYLESHEET_FILE,
} from "../../web/non-production/assets";
import { REPO_ROOT } from "../../src/__tests__/config-invariant-helpers";

const CHECK_SCRIPT = join(REPO_ROOT, "scripts/check-production-bundle.sh");
const WORKER_WITH_TESTING_API = `app.post("${TESTING_PATH}/signed-in-users")`;
const WORKER_WITHOUT_TESTING_API = 'app.get("/health")';
const WORKER_WITH_DEV_HOME = 'app.get("/dev-home")';

const bundleDirs: string[] = [];

afterEach(() => {
  for (const dir of bundleDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const bundleDir = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "production-bundle-"));
  bundleDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

const PRODUCTION_WEB_DIST = { "index.html": "<!doctype html>", "assets/index-abc.js": "spa" };

const webDistDir = (files: Record<string, string> = {}) =>
  bundleDir({ ...PRODUCTION_WEB_DIST, ...files });

const runBundleCheck = (...args: string[]) => {
  const result = Bun.spawnSync(["bash", CHECK_SCRIPT, ...args]);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

describe("本番の bundle の検査は、試験 API の path を含む bundle で deploy を止める", () => {
  test("検査する path は、試験 API の route と SDK が使う TESTING_PATH と同じ", () => {
    const scriptPath = readFileSync(CHECK_SCRIPT, "utf8").match(
      /^testing_api_path="([^"]*)"$/m,
    )?.[1];

    expect(scriptPath).toBe(TESTING_PATH);
  });

  test("worker.js が試験 API の path を含むと、0 以外で終わる", () => {
    const dir = bundleDir({ "worker.js": WORKER_WITH_TESTING_API });

    expect(runBundleCheck(dir, webDistDir()).exitCode).not.toBe(0);
  });

  test("試験 API の path を含む file の path を stdout に出す", () => {
    const dir = bundleDir({ "worker.js": WORKER_WITH_TESTING_API });

    expect(runBundleCheck(dir, webDistDir()).stdout).toBe(`${join(dir, "worker.js")}\n`);
  });

  test("worker.js 以外の module が試験 API の path を含むと、0 以外で終わる", () => {
    const dir = bundleDir({
      "worker.js": 'import "./extra.mjs";',
      "extra.mjs": `export const path = "${TESTING_PATH}";`,
    });

    expect(runBundleCheck(dir, webDistDir()).exitCode).not.toBe(0);
  });

  test("試験 API の path も開発者ホームの path も含まない bundle は、0 で終わり OK を出す", () => {
    const dir = bundleDir({
      "worker.js": WORKER_WITHOUT_TESTING_API,
      "worker.js.map": '{"sources":["src/worker.ts"]}',
      "README.md": "wrangler output",
    });

    expect(runBundleCheck(dir, webDistDir())).toMatchObject({
      exitCode: 0,
      stdout: `OK: production bundle has no ${TESTING_PATH} or /dev-home\n`,
    });
  });

  test("実行されない source map だけが試験 API の path を含む bundle は、0 で終わる", () => {
    const dir = bundleDir({
      "worker.js": WORKER_WITHOUT_TESTING_API,
      "worker.js.map": `{"sourcesContent":["${TESTING_PATH}"]}`,
    });

    expect(runBundleCheck(dir, webDistDir()).exitCode).toBe(0);
  });
});

describe("本番の bundle の検査は、本番以外の値と送ったメールの記録を含む bundle で deploy を止める", () => {
  test.each([
    [
      "worker に本番以外の redirect 先の host",
      { "worker.js": "/^auth\\.taimei-code\\.(com|localhost)$|^localhost$/" },
      {},
    ],
    [
      "web に本番以外の redirect 先の host",
      { "worker.js": WORKER_WITHOUT_TESTING_API },
      { "assets/index-abc.js": "auth.taimei-code.localhost" },
    ],
    [
      "worker に送ったメールの記録の行",
      { "worker.js": 'console.log("[TEST] Magic Link for " + email + ": " + url)' },
      {},
    ],
  ] as const)("%s があると、0 以外で終わる", (_, worker, web) => {
    expect(runBundleCheck(bundleDir(worker), webDistDir(web)).exitCode).not.toBe(0);
  });
});

describe("本番の bundle の検査は、本番以外の entry だけが持つ開発者ホームを含む bundle で deploy を止める", () => {
  test("worker.js が開発者ホームの path を含むと、0 以外で終わる", () => {
    const dir = bundleDir({ "worker.js": WORKER_WITH_DEV_HOME });

    expect(runBundleCheck(dir, webDistDir()).exitCode).not.toBe(0);
  });

  test("開発者ホームの module を bundle すると、検査が 0 以外で終わる (bun test の中の Bun.build は web/ の file の拡張子の無い相対 import を解決できないので、別の process の bun build で bundle する)", () => {
    const dir = bundleDir({});
    const built = Bun.spawnSync([
      "bun",
      "build",
      join(REPO_ROOT, "testing/dev-home.ts"),
      "--outfile",
      join(dir, "worker.js"),
      "--target",
      "bun",
    ]);

    expect(built.exitCode).toBe(0);
    expect(runBundleCheck(dir, webDistDir()).exitCode).not.toBe(0);
  });
});

describe("本番の bundle の検査は、本番以外の画面を含む web の build で deploy を止める", () => {
  test("検査が探す file の名前は、web の build が本番以外の画面に付ける entry の名前と同じ", () => {
    const scriptAssetName = readFileSync(CHECK_SCRIPT, "utf8").match(
      /^non_production_asset_name="([^"]*)"$/m,
    )?.[1];

    expect(scriptAssetName).toBe(`${NON_PRODUCTION_ENTRY_NAME}.*`);
  });

  test.each([
    NON_PRODUCTION_SCRIPT_FILE,
    NON_PRODUCTION_STYLESHEET_FILE,
  ])("web の build が本番以外の画面の %s を含むと、0 以外で終わり、その file を stdout に出す", (file) => {
    const webDist = webDistDir({ [file]: "x" });

    const result = runBundleCheck(bundleDir({ "worker.js": WORKER_WITHOUT_TESTING_API }), webDist);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe(`${join(webDist, file)}\n`);
  });

  test("web の build が開発者ホームの path を含むと、0 以外で終わる", () => {
    const result = runBundleCheck(
      bundleDir({ "worker.js": WORKER_WITHOUT_TESTING_API }),
      webDistDir({ "assets/index-abc.js": 'fetch("/dev-home")' }),
    );

    expect(result.exitCode).not.toBe(0);
  });
});

describe("本番の bundle の検査は、検査できない時に通さない", () => {
  test("web の build の dir を渡さないと、使い方を出して 0 以外で終わる", () => {
    const result = runBundleCheck(bundleDir({ "worker.js": WORKER_WITHOUT_TESTING_API }));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("usage:");
  });

  test("web の build の dir に index.html が無いと、0 以外で終わる", () => {
    const result = runBundleCheck(
      bundleDir({ "worker.js": WORKER_WITHOUT_TESTING_API }),
      bundleDir({ "assets/index-abc.js": "spa" }),
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("index.html is missing or empty");
  });

  test("bundle の dir を渡さないと、使い方を出して 0 以外で終わる", () => {
    const result = runBundleCheck();

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("usage:");
  });

  test("worker.js が無い dir は、0 以外で終わる", () => {
    const result = runBundleCheck(bundleDir({ "README.md": "wrangler output" }), webDistDir());

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("worker.js is missing or empty");
  });

  test("worker.js が 0 byte の dir は、0 以外で終わる", () => {
    expect(runBundleCheck(bundleDir({ "worker.js": "" }), webDistDir()).exitCode).not.toBe(0);
  });

  test("読めない file を含む dir は、0 以外で終わる", () => {
    const dir = bundleDir({ "worker.js": WORKER_WITHOUT_TESTING_API, "chunk.js": "" });
    chmodSync(join(dir, "chunk.js"), 0o000);

    expect(runBundleCheck(dir, webDistDir()).exitCode).not.toBe(0);
  });
});

type WorkflowStep = { readonly run?: string };

const deploySteps = (): WorkflowStep[] => {
  const workflow = Bun.YAML.parse(
    readFileSync(join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf8"),
  ) as { jobs: { deploy: { steps: WorkflowStep[] } } };
  return workflow.jobs.deploy.steps;
};

const PRODUCTION_TREE_SCRIPT = "scripts/build-production-tree.sh";

const isProductionTreeStep = ({ run = "" }: WorkflowStep) => run.includes(PRODUCTION_TREE_SCRIPT);

const indexOfStepRunning = (steps: readonly WorkflowStep[], fragment: string) =>
  steps.findIndex(({ run = "" }) => run.includes(fragment));

describe("deploy の workflow は、本番の状態を変える前に本番の bundle を検査する", () => {
  test("除外した tree で本番を build する script は、dry-run で出した bundle と web の build の出力を検査して終わる", () => {
    const script = readFileSync(join(REPO_ROOT, PRODUCTION_TREE_SCRIPT), "utf8").trimEnd();
    expect(script).toContain("bunx wrangler versions upload --dry-run --outdir production-bundle");
    expect(script.split("\n").at(-1)).toBe(
      "bash scripts/check-production-bundle.sh production-bundle web/dist",
    );
  });

  test("その step は migrations と upload の前にある", () => {
    const steps = deploySteps();
    const checkStep = steps.findIndex(isProductionTreeStep);

    expect(checkStep).toBeGreaterThanOrEqual(0);
    expect(checkStep).toBeLessThan(indexOfStepRunning(steps, "db:migrate"));
    expect(checkStep).toBeLessThan(indexOfStepRunning(steps, "wrangler versions upload --tag"));
  });

  test("その step は name と run だけを持ち、失敗を無視する設定・実行の条件・env を持たない", () => {
    expect(
      deploySteps()
        .filter(isProductionTreeStep)
        .map((step) => Object.keys(step).sort()),
    ).toEqual([["name", "run"]]);
  });

  test("その step の run は secret を参照しない", () => {
    expect(
      deploySteps()
        .filter(isProductionTreeStep)
        .map(({ run = "" }) => run.includes("secrets.")),
    ).toEqual([false]);
  });
});
