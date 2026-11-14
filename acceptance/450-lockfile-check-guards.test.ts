import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CHECK_SCRIPT = "scripts/check-lockfile-release-age.ts";
const CI_WORKFLOW = ".github/workflows/ci.yml";

const SEVEN_DAYS_IN_SECONDS = 7 * 86_400;
const DAY_MS = 86_400_000;
const SPAWN_TIMEOUT_MS = 300_000;

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

const temporaryDirs: string[] = [];
const temporaryDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const writeInto = (dir: string, path: string, content: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const configWithAbsolutePlugins = () => {
  const config: { jsPlugins?: Array<string | { name: string; specifier: string }> } = JSON.parse(
    read(".oxlintrc.json"),
  );
  const absolute = (specifier: string) =>
    specifier.startsWith(".") ? join(REPO_ROOT, specifier) : specifier;
  return JSON.stringify({
    ...config,
    jsPlugins: (config.jsPlugins ?? []).map((plugin) =>
      typeof plugin === "string"
        ? absolute(plugin)
        : { ...plugin, specifier: absolute(plugin.specifier) },
    ),
  });
};

interface Diagnostic {
  filename: string;
  severity: string;
}

const lintErrorsIn = (path: string, source: string) => {
  const dir = temporaryDir("acceptance-450-lint-");
  writeInto(dir, ".oxlintrc.json", configWithAbsolutePlugins());
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  writeInto(dir, path, `${source}\n`);
  writeInto(dir, "scripts/sibling.ts", "export const sibling = 1;\n");
  const ran = spawnSync(
    join(REPO_ROOT, "node_modules/.bin/oxlint"),
    ["--disable-nested-config", "--format", "json", path],
    { cwd: dir, encoding: "utf8", env: shellEnv },
  );
  const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(ran.stdout);
  return diagnostics.filter(
    (diagnostic) => diagnostic.filename === path && diagnostic.severity === "error",
  ).length;
};

describe("scripts/ の import は node: の組み込みの module だけ (#450)", () => {
  test.each([
    ["package", 'import { Effect } from "effect";\nexport const used = Effect;'],
    ["型だけの package", 'import type { Effect } from "effect";\nexport type Used = Effect.Effect<1>;'],
    ["package の再 export", 'export { Effect } from "effect";'],
    ["相対の path", 'import { sibling } from "./sibling";\nexport const used = sibling;'],
    ["literal の import()", 'export const loaded = await import("effect");'],
  ])("AC-001: scripts/ の TS が %s を import すると、oxlint が止める", (_kind, source) => {
    expect(lintErrorsIn("scripts/probe.ts", source)).toBeGreaterThan(0);
  });

  test("AC-002: scripts/ の TS が node: の module だけを import するなら、oxlint は止めない", () => {
    expect(
      lintErrorsIn(
        "scripts/probe.ts",
        'import { join } from "node:path";\nimport { argv } from "node:process";\nexport const used = join(argv[0] ?? "", "x");',
      ),
    ).toBe(0);
  });
});

const INSTALL_STEP = [
  "      - name: Install dependencies",
  "        run: bun install --frozen-lockfile --ignore-scripts",
  "",
].join("\n");
const BUN_LOCK_STEP = [
  "      - name: Release age of the versions this PR adds to bun.lock",
  `        run: bun ${CHECK_SCRIPT} origin/main`,
  "",
].join("\n");
const FULL_HISTORY = "        with:\n          fetch-depth: 0";

const replaceOnce = (text: string, from: string, to: string) => {
  const index = text.indexOf(from);
  if (index === -1 || text.indexOf(from, index + 1) !== -1) {
    throw new Error(`ci.yml の書き換え元が 1 か所でない: ${JSON.stringify(from)}`);
  }
  return `${text.slice(0, index)}${to}${text.slice(index + from.length)}`;
};

const bunLockStepAfterInstall = (workflow: string) =>
  replaceOnce(workflow, `${BUN_LOCK_STEP}\n${INSTALL_STEP}`, `${INSTALL_STEP}\n${BUN_LOCK_STEP}`);

const checkoutWithoutFullHistory = (workflow: string) => {
  const checkJob = workflow.slice(workflow.indexOf("  check:"), workflow.indexOf(BUN_LOCK_STEP));
  const withoutFullHistory = replaceOnce(checkJob, FULL_HISTORY, "");
  return workflow.replace(checkJob, withoutFullHistory);
};

const unchanged = (workflow: string) => workflow;

const ENTRIES_THE_COPY_OWNS = new Set([".git", ".github", "src"]);

const workflowTestFiles = () => {
  const grepped = spawnSync(
    "git",
    ["grep", "-l", "--untracked", "-F", CHECK_SCRIPT, "--", "src/__tests__"],
    { cwd: REPO_ROOT, encoding: "utf8", env: shellEnv },
  );
  if (grepped.status !== 0 && grepped.status !== 1) {
    throw new Error(`git grep が失敗した (status ${grepped.status})\n${grepped.stderr}`);
  }
  return grepped.stdout.split("\n").filter((line) => line !== "");
};

const workflowTestsPassWith = (rewriteWorkflow: (workflow: string) => string) => {
  const files = workflowTestFiles();
  expect(files.length).toBeGreaterThan(0);
  const root = temporaryDir("acceptance-450-tree-");
  for (const entry of readdirSync(REPO_ROOT)) {
    if (!ENTRIES_THE_COPY_OWNS.has(entry)) {
      symlinkSync(join(REPO_ROOT, entry), join(root, entry));
    }
  }
  cpSync(join(REPO_ROOT, "src"), join(root, "src"), { recursive: true });
  cpSync(join(REPO_ROOT, ".github"), join(root, ".github"), { recursive: true });
  writeFileSync(join(root, CI_WORKFLOW), rewriteWorkflow(read(CI_WORKFLOW)));
  const ran = spawnSync("bun", ["test", ...files.map((file) => `./${file}`)], {
    cwd: root,
    encoding: "utf8",
    env: shellEnv,
    timeout: SPAWN_TIMEOUT_MS,
  });
  return ran.status === 0;
};

describe("ci.yml の bun.lock の step の置き場所を、src/__tests__ の試験が固定する (#450)", () => {
  test(
    "AC-003: check job の bun.lock の step を bun install の step の後へ動かすと、試験が落ちる",
    () => {
      expect(workflowTestsPassWith(bunLockStepAfterInstall)).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-004: check job の checkout から fetch-depth: 0 を消すと、試験が落ちる",
    () => {
      expect(workflowTestsPassWith(checkoutWithoutFullHistory)).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-005: ci.yml を変えなければ、試験が通る",
    () => {
      expect(workflowTestsPassWith(unchanged)).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );
});

type LockEntry = readonly unknown[];

interface RegistryPackage {
  name: string;
  version: string;
  ageDays: number;
}

const OLD = { name: "taimei-auth-450-old", version: "1.0.0", ageDays: 30 };
const YOUNG = { name: "taimei-auth-450-young", version: "1.0.0", ageDays: 1 };
const SCOPED_OLD = { name: "@taimei-auth-450/old", version: "1.0.0", ageDays: 30 };
const SCOPED_YOUNG = { name: "@taimei-auth-450/young", version: "1.0.0", ageDays: 1 };

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
  name: "taimei-auth-450-git",
  entry: [
    "taimei-auth-450-git@git+ssh://git@github.com/taimei-code/taimei-auth-450-git.git#0123456",
    {},
    "taimei-code-taimei-auth-450-git-0123456",
  ],
};

const lockfileWith = (entries: readonly LockEntry[]) =>
  JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "taimei-auth-450-fixture" } },
    packages: Object.fromEntries(entries.map((entry, index) => [`pkg-${index}`, entry])),
  });

const servers: { stop: (force?: boolean) => unknown }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const answeringRegistry = (packages: readonly RegistryPackage[]) => {
  const now = Date.now();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
      const pkg = packages.find((candidate) => candidate.name === name);
      if (pkg === undefined) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const publishedAt = new Date(now - pkg.ageDays * DAY_MS).toISOString();
      return Response.json({
        name: pkg.name,
        versions: { [pkg.version]: { name: pkg.name, version: pkg.version } },
        time: { created: publishedAt, modified: publishedAt, [pkg.version]: publishedAt },
      });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/`;
};

const failingRegistry = () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("registry is down", { status: 503 }),
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/`;
};

const git = (cwd: string, args: readonly string[]) => {
  const ran = spawnSync(
    "git",
    [
      "-c",
      "user.name=acceptance",
      "-c",
      "user.email=acceptance@example.invalid",
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

interface PullRequest {
  base: readonly LockEntry[];
  head: readonly LockEntry[];
  registry: string;
  excludes?: readonly string[];
  minimumReleaseAge?: string;
  from?: "root" | "subdirectory";
}

const SUBDIRECTORY = "web";

const runCheckOn = async ({
  base,
  head,
  registry,
  excludes = [],
  minimumReleaseAge = String(SEVEN_DAYS_IN_SECONDS),
  from = "root",
}: PullRequest) => {
  const root = temporaryDir("acceptance-450-repo-");
  writeInto(
    root,
    "bunfig.toml",
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
  writeInto(root, "bun.lock", lockfileWith(base));
  writeInto(root, `${SUBDIRECTORY}/.keep`, "");
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "base"]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  writeInto(root, "bun.lock", lockfileWith(head));
  git(root, ["commit", "--quiet", "-am", "head"]);
  const child = Bun.spawn(["bun", join(REPO_ROOT, CHECK_SCRIPT), "origin/main"], {
    cwd: from === "root" ? root : join(root, SUBDIRECTORY),
    env: shellEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { passed: exitCode === 0, output: `${stdout}${stderr}` };
};

describe("bun.lock の公開日時の検査の、封の後に足した振る舞い (#450)", () => {
  test.each([
    ["AC-006", "scoped な package の tarball", SCOPED_TARBALL],
    ["AC-007", "GitHub", GITHUB],
    ["AC-008", "git+ssh://git@…", GIT_SSH],
  ])(
    "%s: minimumReleaseAgeExcludes に書いた %s の entry を足した PR は、registry が 5xx でも通る",
    async (_id, _kind, { name, entry }) => {
      const observed = await runCheckOn({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), entry],
        registry: failingRegistry(),
        excludes: [name],
      });
      expect(observed).toEqual({ passed: true, output: expect.any(String) });
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-009: minimumReleaseAgeExcludes に書かない GitHub の entry を足した PR は落ち、その entry を名指す",
    async () => {
      const observed = await runCheckOn({
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
    "AC-010: 公開から 1 日の scoped な名前の版を足した PR は落ち、その版を名指す",
    async () => {
      const observed = await runCheckOn({
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
    "AC-011: 公開から 30 日の scoped な名前の版だけを足した PR は通る",
    async () => {
      const observed = await runCheckOn({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), registryEntry(SCOPED_OLD)],
        registry: answeringRegistry([OLD, SCOPED_OLD]),
      });
      expect(observed).toEqual({ passed: true, output: expect.any(String) });
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-012: repo の下の directory から走らせても、root の bunfig.toml と bun.lock を読み、公開から 1 日の版を名指して落ちる",
    async () => {
      const observed = await runCheckOn({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), registryEntry(YOUNG)],
        registry: answeringRegistry([OLD, YOUNG]),
        from: "subdirectory",
      });
      expect(observed.passed).toBe(false);
      expect(observed.output).toContain(`${YOUNG.name}@${YOUNG.version}`);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-013: repo の下の directory から走らせても、公開から 30 日の版だけを足した PR は通る",
    async () => {
      const observed = await runCheckOn({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), registryEntry(SCOPED_OLD)],
        registry: answeringRegistry([OLD, SCOPED_OLD]),
        from: "subdirectory",
      });
      expect(observed).toEqual({ passed: true, output: expect.any(String) });
    },
    SPAWN_TIMEOUT_MS,
  );

  test.each(["-1", "nan", "-inf", "inf"])(
    "AC-014: minimumReleaseAge が %s なら、公開から 30 日の版だけを足した PR でも落ちる",
    async (minimumReleaseAge) => {
      const observed = await runCheckOn({
        base: [registryEntry(OLD)],
        head: [registryEntry(OLD), registryEntry(SCOPED_OLD)],
        registry: answeringRegistry([OLD, SCOPED_OLD]),
        minimumReleaseAge,
        from: "subdirectory",
      });
      expect(observed.passed).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});
