import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CI_WORKFLOW = ".github/workflows/ci.yml";
const ADR_0009 = "docs/adr/0009-supply-chain-hardening.md";

const SEVEN_DAYS_IN_SECONDS = 7 * 86_400;
const DAY_MS = 86_400_000;
const STEP_TIMEOUT_MS = 60_000;

const ENTRIES_THE_TREE_OWNS = new Set([".git", "bun.lock", "bunfig.toml"]);

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

const OLD_PACKAGE = { name: "taimei-auth-440-old", version: "1.0.0", ageDays: 30 };
const YOUNG_PACKAGE = { name: "taimei-auth-440-young", version: "1.0.0", ageDays: 1 };
const ANOTHER_OLD_PACKAGE = { name: "taimei-auth-440-another-old", version: "2.0.0", ageDays: 30 };

type FixturePackage = typeof OLD_PACKAGE;

interface WorkflowStep {
  name?: string;
  run?: string;
  if?: unknown;
  "continue-on-error"?: unknown;
}

interface Workflow {
  on: unknown;
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

const ciWorkflow = () =>
  Bun.YAML.parse(readFileSync(join(REPO_ROOT, CI_WORKFLOW), "utf8")) as Workflow;

const bunLockSteps = () =>
  Object.values(ciWorkflow().jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.name?.includes("bun.lock") === true);

const lockfileWith = (packages: readonly FixturePackage[]) =>
  JSON.stringify(
    {
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: {
        "": {
          name: "taimei-auth-440-fixture",
          dependencies: Object.fromEntries(packages.map((pkg) => [pkg.name, pkg.version])),
        },
      },
      packages: Object.fromEntries(
        packages.map((pkg) => [
          pkg.name,
          [`${pkg.name}@${pkg.version}`, "", {}, `sha512-${pkg.name}`],
        ]),
      ),
    },
    null,
    2,
  );

const packumentOf = (pkg: FixturePackage, now: number) => {
  const publishedAt = new Date(now - pkg.ageDays * DAY_MS).toISOString();
  return {
    name: pkg.name,
    "dist-tags": { latest: pkg.version },
    versions: { [pkg.version]: { name: pkg.name, version: pkg.version } },
    time: { created: publishedAt, modified: publishedAt, [pkg.version]: publishedAt },
  };
};

type RegistryMode = "answers" | "fails";

const servers: { stop: (force?: boolean) => unknown }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const fakeRegistry = (mode: RegistryMode, packages: readonly FixturePackage[]) => {
  const now = Date.now();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (mode === "fails") {
        return new Response("registry is down", { status: 503 });
      }
      const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
      const pkg = packages.find((candidate) => candidate.name === name);
      return pkg === undefined
        ? Response.json({ error: "Not found" }, { status: 404 })
        : Response.json(packumentOf(pkg, now));
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/`;
};

const unreachableRegistry = () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const url = `http://127.0.0.1:${server.port}/`;
  server.stop(true);
  return url;
};

const bunfigWith = (registry: string, excludes: readonly string[]) =>
  [
    "[install]",
    `minimumReleaseAge = ${SEVEN_DAYS_IN_SECONDS}`,
    `registry = "${registry}"`,
    ...(excludes.length === 0
      ? []
      : [`minimumReleaseAgeExcludes = [${excludes.map((name) => `"${name}"`).join(", ")}]`]),
    "",
  ].join("\n");

const git = (cwd: string, args: readonly string[]) => {
  const ran = spawnSync(
    "git",
    ["-c", "user.name=acceptance", "-c", "user.email=acceptance@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", env: shellEnv },
  );
  if (ran.status !== 0) {
    throw new Error(`git ${args.join(" ")} に失敗した\n${ran.stderr}`);
  }
};

interface PullRequest {
  base: readonly FixturePackage[];
  head: readonly FixturePackage[];
  registry: string;
  excludes?: readonly string[];
}

const runBunLockStepsOn = async ({ base, head, registry, excludes = [] }: PullRequest) => {
  const steps = bunLockSteps();
  expect(steps.length).toBeGreaterThan(0);
  const root = mkdtempSync(join(tmpdir(), "taimei-auth-440-tree-"));
  try {
    for (const entry of readdirSync(REPO_ROOT)) {
      if (!ENTRIES_THE_TREE_OWNS.has(entry)) {
        symlinkSync(join(REPO_ROOT, entry), join(root, entry));
      }
    }
    writeFileSync(join(root, "bunfig.toml"), bunfigWith(registry, excludes));
    writeFileSync(join(root, "bun.lock"), lockfileWith(base));
    git(root, ["init", "--quiet", "--initial-branch=main"]);
    git(root, ["add", "bun.lock", "bunfig.toml"]);
    git(root, ["commit", "--quiet", "-m", "base"]);
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    writeFileSync(join(root, "bun.lock"), lockfileWith(head));
    git(root, ["commit", "--quiet", "--allow-empty", "-am", "head"]);

    const results = [];
    for (const step of steps) {
      const child = Bun.spawn(["sh", "-c", step.run ?? ""], {
        cwd: root,
        env: shellEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      results.push({ exitCode, output: `${stdout}${stderr}` });
    }
    return {
      succeeded: results.every((result) => result.exitCode === 0),
      output: results.map((result) => result.output).join("\n"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("bun.lock に入った、公開から 7 日未満の版を CI で止める (#440)", () => {
  test(
    "AC-001: 公開から 1 日の版を bun.lock に足した PR では、CI の bun.lock の step が落ち、その版を名指しする",
    async () => {
      const packages = [OLD_PACKAGE, YOUNG_PACKAGE];
      const observed = await runBunLockStepsOn({
        base: [OLD_PACKAGE],
        head: packages,
        registry: fakeRegistry("answers", packages),
      });
      expect(observed.succeeded).toBe(false);
      expect(observed.output).toContain(`${YOUNG_PACKAGE.name}@${YOUNG_PACKAGE.version}`);
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "AC-002: 公開から 30 日の版だけを bun.lock に足した PR では、CI の bun.lock の step が通る",
    async () => {
      const packages = [OLD_PACKAGE, ANOTHER_OLD_PACKAGE];
      const observed = await runBunLockStepsOn({
        base: [OLD_PACKAGE],
        head: packages,
        registry: fakeRegistry("answers", packages),
      });
      expect(observed).toEqual({ succeeded: true, output: expect.any(String) });
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "AC-003: bun.lock を base から変えない PR では、CI の bun.lock の step が通る",
    async () => {
      const observed = await runBunLockStepsOn({
        base: [OLD_PACKAGE],
        head: [OLD_PACKAGE],
        registry: fakeRegistry("answers", [OLD_PACKAGE]),
      });
      expect(observed).toEqual({ succeeded: true, output: expect.any(String) });
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "AC-004: 公開から 1 日の版でも、minimumReleaseAgeExcludes に書いた package なら CI の bun.lock の step が通る",
    async () => {
      const packages = [OLD_PACKAGE, YOUNG_PACKAGE];
      const observed = await runBunLockStepsOn({
        base: [OLD_PACKAGE],
        head: packages,
        registry: fakeRegistry("answers", packages),
        excludes: [YOUNG_PACKAGE.name],
      });
      expect(observed).toEqual({ succeeded: true, output: expect.any(String) });
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "AC-005: 版を足した PR で registry が 5xx を返すと、CI の bun.lock の step が落ちる",
    async () => {
      const observed = await runBunLockStepsOn({
        base: [OLD_PACKAGE],
        head: [OLD_PACKAGE, ANOTHER_OLD_PACKAGE],
        registry: fakeRegistry("fails", []),
      });
      expect(observed.succeeded).toBe(false);
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "AC-006: 版を足した PR で registry に接続できないと、CI の bun.lock の step が落ちる",
    async () => {
      const observed = await runBunLockStepsOn({
        base: [OLD_PACKAGE],
        head: [OLD_PACKAGE, ANOTHER_OLD_PACKAGE],
        registry: unreachableRegistry(),
      });
      expect(observed.succeeded).toBe(false);
    },
    STEP_TIMEOUT_MS,
  );

  test("AC-007: pull_request で走る ci.yml に、bun.lock の step があり、if と continue-on-error を持たない", () => {
    const { on } = ciWorkflow();
    expect(on).toHaveProperty("pull_request");
    const steps = bunLockSteps();
    expect(steps.length).toBeGreaterThan(0);
    expect(
      steps.map((step) => ({ if: step.if, continueOnError: step["continue-on-error"] })),
    ).toEqual(steps.map(() => ({ if: undefined, continueOnError: undefined })));
  });

  test("AC-008: ADR-0009 は ci.yml と、CI の bun.lock の step が走らせる repo の file を名指しする", () => {
    const runFiles = bunLockSteps()
      .flatMap((step) => (step.run ?? "").split(/\s+/))
      .filter((token) => {
        const path = join(REPO_ROOT, token);
        return token !== "" && existsSync(path) && statSync(path).isFile();
      });
    expect(runFiles.length).toBeGreaterThan(0);
    const adr = readFileSync(join(REPO_ROOT, ADR_0009), "utf8");
    expect([CI_WORKFLOW, ...runFiles].filter((path) => !adr.includes(path))).toEqual([]);
  });
});
