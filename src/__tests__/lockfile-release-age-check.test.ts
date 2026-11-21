import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { indexOfStepRunning, readWorkflow, REPO_ROOT } from "./config-invariant-helpers";

const CHECK_SCRIPT = "scripts/check-lockfile-release-age.ts";
const SEVEN_DAYS_IN_SECONDS = 7 * 86_400;
const DAY_MS = 86_400_000;
const SPAWN_TIMEOUT_MS = 60_000;

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

interface WorkflowStep {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

const stepsBeforeTheCheck = () => {
  const { jobs: byName } = readWorkflow<{ jobs: Record<string, { steps?: WorkflowStep[] }> }>(
    "ci.yml",
  );
  const jobs = Object.values(byName).flatMap(({ steps = [] }) => {
    const at = indexOfStepRunning(steps, CHECK_SCRIPT);
    return at === -1 ? [] : [steps.slice(0, at)];
  });
  expect(jobs.length).toBeGreaterThan(0);
  return jobs;
};

describe("bun.lock の公開日時の検査は、依存を入れる前に、全ての履歴を持つ checkout で走る (ADR-0009 §H)", () => {
  test("bun.lock の公開日時の step より前に、依存を入れうる run の step を置かない", () => {
    const jobs = stepsBeforeTheCheck();
    expect(jobs.map((steps) => steps.filter((step) => step.run !== undefined))).toEqual(
      jobs.map(() => []),
    );
  });

  test("bun.lock の公開日時の step より前の checkout は、merge-base を引ける fetch-depth: 0 だけ", () => {
    const checkouts = stepsBeforeTheCheck().map((steps) =>
      steps
        .filter((step) => step.uses?.startsWith("actions/checkout@") === true)
        .map((step) => step.with?.["fetch-depth"]),
    );
    expect(checkouts).toEqual(checkouts.map(() => [0]));
  });
});

const repos: string[] = [];
afterAll(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
});

const temporaryRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "lockfile-release-age-"));
  repos.push(root);
  return root;
};

const git = (cwd: string, args: readonly string[]) => {
  const ran = spawnSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", env: shellEnv },
  );
  if (ran.status !== 0) {
    throw new Error(`git ${args.join(" ")} に失敗した\n${ran.stderr}`);
  }
};

const checkFromSubdirectoryWith = (minimumReleaseAge: string) => {
  const root = temporaryRepo();
  writeFileSync(join(root, "bunfig.toml"), `[install]\nminimumReleaseAge = ${minimumReleaseAge}\n`);
  mkdirSync(join(root, "web"));
  expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
  const ran = spawnSync("bun", [join(REPO_ROOT, CHECK_SCRIPT), "origin/main"], {
    cwd: join(root, "web"),
    encoding: "utf8",
  });
  return { exitCode: ran.status, output: ran.stdout };
};

describe("bun.lock の公開日時の検査は、bunfig.toml の minimumReleaseAge を正の有限の数でしか受けない", () => {
  test.each([
    "0",
    "-1",
    "nan",
    "inf",
    "-inf",
  ])("minimumReleaseAge が %s なら、bun が bunfig.toml を読まない下の directory から走らせても、理由を出して落ちる", (minimumReleaseAge) => {
    expect(checkFromSubdirectoryWith(minimumReleaseAge)).toEqual({
      exitCode: 1,
      output: expect.stringContaining("minimumReleaseAge が正の有限の数でない"),
    });
  });
});

const UNREACHABLE_REGISTRY = "http://127.0.0.1:9/";

const checkAddingEntry = (entry: readonly unknown[]) => {
  const root = temporaryRepo();
  const lockWith = (packages: Record<string, readonly unknown[]>) =>
    writeFileSync(join(root, "bun.lock"), JSON.stringify({ lockfileVersion: 1, packages }));
  writeFileSync(
    join(root, "bunfig.toml"),
    `[install]\nminimumReleaseAge = 604800\nregistry = "${UNREACHABLE_REGISTRY}"\n`,
  );
  lockWith({});
  git(root, ["init", "--quiet"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "base"]);
  lockWith({ added: entry });
  return spawnSync("bun", [join(REPO_ROOT, CHECK_SCRIPT), "HEAD"], { cwd: root, encoding: "utf8" })
    .status;
};

describe("bun.lock の公開日時の検査は、workspace の entry だけを registry に問わずに通す", () => {
  test("版が workspace: の entry は、registry に届かなくても通る", () => {
    expect(checkAddingEntry(["@taimei-code/auth-client@workspace:packages/auth-client"])).toBe(0);
  });

  test("URL に @workspace: を含むだけの entry は、workspace の entry として通さない", () => {
    expect(checkAddingEntry(["x@https://h.example/@workspace:/x.tgz", {}, "sha512-x"])).toBe(1);
  });

  test("名前と版に分けられない entry は、registry に問う前に落ちる", () => {
    expect(checkAddingEntry(["x", "", {}, "sha512-x"])).toBe(1);
  });
});

type LockEntry = readonly unknown[];

interface RegistryPackage {
  name: string;
  version: string;
  ageDays: number;
}

const OLD = { name: "taimei-auth-old", version: "1.0.0", ageDays: 30 };
const ANOTHER_OLD = { name: "taimei-auth-another-old", version: "2.0.0", ageDays: 30 };
const YOUNG = { name: "taimei-auth-young", version: "1.0.0", ageDays: 1 };
const SCOPED_OLD = { name: "@taimei-auth/old", version: "1.0.0", ageDays: 30 };
const SCOPED_YOUNG = { name: "@taimei-auth/young", version: "1.0.0", ageDays: 1 };

const registryEntry = (pkg: RegistryPackage): LockEntry => [
  `${pkg.name}@${pkg.version}`,
  "",
  {},
  `sha512-${pkg.name}`,
];

const SCOPED_TARBALL = {
  name: "@sindresorhus/is",
  entry: [
    "@sindresorhus/is@https://registry.npmjs.org/@sindresorhus/is/-/is-4.6.0.tgz",
    { hasInstallScript: true },
    "sha512-t09vSN3MdfsyCHoFcTRCH/iUtG7OJ0CsjzB8cjAmKc/va/kIgeDI/TxsigdncE/4be734m0cvIYwNaV4i2XqAw==",
  ],
};
const GITHUB_ID = "is-odd@github:i-voted-for-trump/is-odd#a80ee0d";
const GITHUB = {
  name: "is-odd",
  entry: [
    GITHUB_ID,
    { dependencies: { "is-number": "^6.0.0" } },
    "i-voted-for-trump-is-odd-a80ee0d",
    "sha512-dBA2mPdaaMASZEc3d1TdKuruk6i+kArDS+nCR3oXlsUS0zVz4RhN7aKVmvB8FVdLiRpySuoBPRXd8I3A1IDf8Q==",
  ],
};
const GIT_SSH = {
  name: "taimei-auth-git",
  entry: [
    "taimei-auth-git@git+ssh://git@github.com/taimei-code/taimei-auth-git.git#0123456",
    {},
    "taimei-code-taimei-auth-git-0123456",
  ],
};

const servers: { stop: (force?: boolean) => unknown }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const serveRegistry = (respond: (name: string) => Response) => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => respond(decodeURIComponent(new URL(request.url).pathname.slice(1))),
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/`;
};

const answeringRegistry = (packages: readonly RegistryPackage[]) => {
  const now = Date.now();
  return serveRegistry((name) => {
    const pkg = packages.find((candidate) => candidate.name === name);
    if (pkg === undefined) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const publishedAt = new Date(now - pkg.ageDays * DAY_MS).toISOString();
    return Response.json({
      name: pkg.name,
      "dist-tags": { latest: pkg.version },
      versions: { [pkg.version]: { name: pkg.name, version: pkg.version } },
      time: { created: publishedAt, modified: publishedAt, [pkg.version]: publishedAt },
    });
  });
};

const failingRegistry = () =>
  serveRegistry(() => new Response("registry is down", { status: 503 }));

const unreachableRegistry = () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const url = `http://127.0.0.1:${server.port}/`;
  void server.stop(true);
  return url;
};

const lockfileWith = (entries: readonly LockEntry[]) =>
  JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "taimei-auth-fixture" } },
    packages: Object.fromEntries(entries.map((entry, index) => [`pkg-${index}`, entry])),
  });

interface PullRequest {
  base: readonly LockEntry[];
  head: readonly LockEntry[];
  registry: string;
  excludes?: readonly string[];
  minimumReleaseAge?: string;
}

const SUBDIRECTORY = "web";

const openPullRequest = ({
  base,
  head,
  registry,
  excludes = [],
  minimumReleaseAge = String(SEVEN_DAYS_IN_SECONDS),
}: PullRequest) => {
  const root = temporaryRepo();
  writeFileSync(
    join(root, "bunfig.toml"),
    [
      "[install]",
      `minimumReleaseAge = ${minimumReleaseAge}`,
      `registry = "${registry}"`,
      ...(excludes.length === 0
        ? []
        : [`minimumReleaseAgeExcludes = [${excludes.map((name) => `"${name}"`).join(", ")}]`]),
      "",
    ].join("\n"),
  );
  mkdirSync(join(root, SUBDIRECTORY));
  symlinkSync(join(REPO_ROOT, dirname(CHECK_SCRIPT)), join(root, dirname(CHECK_SCRIPT)));
  writeFileSync(join(root, "bun.lock"), lockfileWith(base));
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["add", "bun.lock", "bunfig.toml"]);
  git(root, ["commit", "--quiet", "-m", "base"]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  writeFileSync(join(root, "bun.lock"), lockfileWith(head));
  git(root, ["commit", "--quiet", "--allow-empty", "-am", "head"]);
  return root;
};

const observe = async (command: readonly string[], cwd: string) => {
  const child = Bun.spawn([...command], { cwd, env: shellEnv, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
};

interface WorkflowStep {
  name?: string;
  run?: string;
  if?: unknown;
  "continue-on-error"?: unknown;
}

const ciWorkflow = () =>
  readWorkflow<{ on: unknown; jobs: Record<string, { steps?: WorkflowStep[] }> }>("ci.yml");

const bunLockSteps = () =>
  Object.values(ciWorkflow().jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.name?.includes("bun.lock") === true);

const runCiBunLockSteps = async (pullRequest: PullRequest) => {
  const steps = bunLockSteps();
  expect(steps.length).toBeGreaterThan(0);
  const root = openPullRequest(pullRequest);
  const results = [];
  for (const step of steps) {
    results.push(await observe(["sh", "-c", step.run ?? ""], root));
  }
  return {
    passed: results.every(({ exitCode }) => exitCode === 0),
    output: results.map(({ output }) => output).join("\n"),
  };
};

const runCheck = async (pullRequest: PullRequest, from: "root" | "subdirectory" = "root") => {
  const root = openPullRequest(pullRequest);
  const { exitCode, output } = await observe(
    ["bun", join(REPO_ROOT, CHECK_SCRIPT), "origin/main"],
    from === "root" ? root : join(root, SUBDIRECTORY),
  );
  return { passed: exitCode === 0, output };
};

const PASSED = { passed: true, output: expect.any(String) };

describe("CI の bun.lock の step は、bun.lock に入った公開から 7 日未満の版を止める", () => {
  test(
    "公開から 1 日の版を bun.lock に足した PR では、CI の bun.lock の step が落ち、その版を名指しする",
    async () => {
      const packages = [OLD, YOUNG];
      const observed = await runCiBunLockSteps({
        base: [registryEntry(OLD)],
        head: packages.map(registryEntry),
        registry: answeringRegistry(packages),
      });
      expect(observed.passed).toBe(false);
      expect(observed.output).toContain(`${YOUNG.name}@${YOUNG.version}`);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "公開から 30 日の版だけを bun.lock に足した PR では、CI の bun.lock の step が通る",
    async () => {
      const packages = [OLD, ANOTHER_OLD];
      const observed = await runCiBunLockSteps({
        base: [registryEntry(OLD)],
        head: packages.map(registryEntry),
        registry: answeringRegistry(packages),
      });
      expect(observed).toEqual(PASSED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "bun.lock を base から変えない PR では、CI の bun.lock の step が通る",
    async () => {
      const observed = await runCiBunLockSteps({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD)],
        registry: answeringRegistry([OLD]),
      });
      expect(observed).toEqual(PASSED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "公開から 1 日の版でも、minimumReleaseAgeExcludes に書いた package なら CI の bun.lock の step が通る",
    async () => {
      const packages = [OLD, YOUNG];
      const observed = await runCiBunLockSteps({
        base: [registryEntry(OLD)],
        head: packages.map(registryEntry),
        registry: answeringRegistry(packages),
        excludes: [YOUNG.name],
      });
      expect(observed).toEqual(PASSED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "版を足した PR で registry が 5xx を返すと、CI の bun.lock の step が落ちる",
    async () => {
      const observed = await runCiBunLockSteps({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), registryEntry(ANOTHER_OLD)],
        registry: failingRegistry(),
      });
      expect(observed.passed).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "版を足した PR で registry に接続できないと、CI の bun.lock の step が落ちる",
    async () => {
      const observed = await runCiBunLockSteps({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), registryEntry(ANOTHER_OLD)],
        registry: unreachableRegistry(),
      });
      expect(observed.passed).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  test("pull_request で走る ci.yml に、bun.lock の step があり、if と continue-on-error を持たない", () => {
    expect(ciWorkflow().on).toHaveProperty("pull_request");
    const steps = bunLockSteps();
    expect(steps.length).toBeGreaterThan(0);
    expect(
      steps.map((step) => ({ if: step.if, continueOnError: step["continue-on-error"] })),
    ).toEqual(steps.map(() => ({ if: undefined, continueOnError: undefined })));
  });
});

describe("bun.lock の公開日時の検査は、registry 以外から入れる entry と scoped な名前と下の directory から走らせた場合も扱う", () => {
  test.each([
    ["scoped な package の tarball", SCOPED_TARBALL],
    ["GitHub", GITHUB],
    ["git+ssh://git@…", GIT_SSH],
  ])(
    "minimumReleaseAgeExcludes に書いた %s の entry を足した PR は、registry が 5xx でも通る",
    async (_kind, { name, entry }) => {
      const observed = await runCheck({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), entry],
        registry: failingRegistry(),
        excludes: [name],
      });
      expect(observed).toEqual(PASSED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "minimumReleaseAgeExcludes に書かない GitHub の entry を足した PR は落ち、その entry を名指す",
    async () => {
      const observed = await runCheck({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), GITHUB.entry],
        registry: answeringRegistry([OLD]),
      });
      expect(observed.passed).toBe(false);
      expect(observed.output).toContain(GITHUB_ID);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "公開から 1 日の scoped な名前の版を足した PR は落ち、その版を名指す",
    async () => {
      const observed = await runCheck({
        base: [registryEntry(SCOPED_OLD)],
        head: [registryEntry(SCOPED_OLD), registryEntry(SCOPED_YOUNG)],
        registry: answeringRegistry([SCOPED_OLD, SCOPED_YOUNG]),
      });
      expect(observed.passed).toBe(false);
      expect(observed.output).toContain(`${SCOPED_YOUNG.name}@${SCOPED_YOUNG.version}`);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "公開から 30 日の scoped な名前の版だけを足した PR は通る",
    async () => {
      const observed = await runCheck({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), registryEntry(SCOPED_OLD)],
        registry: answeringRegistry([OLD, SCOPED_OLD]),
      });
      expect(observed).toEqual(PASSED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "repo の下の directory から走らせても、root の bunfig.toml と bun.lock を読み、公開から 1 日の版を名指して落ちる",
    async () => {
      const observed = await runCheck(
        {
          base: [registryEntry(OLD)],
          head: [registryEntry(OLD), registryEntry(YOUNG)],
          registry: answeringRegistry([OLD, YOUNG]),
        },
        "subdirectory",
      );
      expect(observed.passed).toBe(false);
      expect(observed.output).toContain(`${YOUNG.name}@${YOUNG.version}`);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "repo の下の directory から走らせても、公開から 30 日の版だけを足した PR は通る",
    async () => {
      const observed = await runCheck(
        {
          base: [registryEntry(OLD)],
          head: [registryEntry(OLD), registryEntry(SCOPED_OLD)],
          registry: answeringRegistry([OLD, SCOPED_OLD]),
        },
        "subdirectory",
      );
      expect(observed).toEqual(PASSED);
    },
    SPAWN_TIMEOUT_MS,
  );
});
