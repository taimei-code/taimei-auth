import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const ADR_0009 = "docs/adr/0009-supply-chain-hardening.md";
const DEPENDABOT_YML = ".github/dependabot.yml";
const COOLDOWN_TEST = "src/__tests__/dependabot-cooldown.test.ts";
const ENTRIES_THE_TREE_SHARES = ["node_modules", "lint", "package.json", "tsconfig.json"];

const SECONDS_PER_DAY = 86_400;
const SPAWN_TIMEOUT_MS = 120_000;
const GIT_GREP_FOUND_NOTHING = 1;

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

interface DependabotUpdate {
  "package-ecosystem": string;
  directory?: string;
  cooldown?: { "default-days"?: number };
}

interface DependabotConfig {
  updates: DependabotUpdate[];
}

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const readDependabot = () => Bun.YAML.parse(read(DEPENDABOT_YML)) as DependabotConfig;

const readMinimumReleaseAge = () =>
  (Bun.TOML.parse(read("bunfig.toml")) as { install: { minimumReleaseAge: number } }).install
    .minimumReleaseAge;

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] => {
  const result = spawnSync(
    "git",
    ["grep", "-n", "-E", "--untracked", pattern, "--", ...pathspecs],
    { cwd: REPO_ROOT, encoding: "utf8", env: shellEnv },
  );
  if (result.status !== 0 && result.status !== GIT_GREP_FOUND_NOTHING) {
    throw new Error(`git grep failed: ${result.stderr}`);
  }
  return result.stdout.split("\n").filter((line) => line !== "");
};

const trees: string[] = [];

afterEach(() => {
  for (const tree of trees.splice(0)) {
    rmSync(tree, { recursive: true, force: true });
  }
});

const runCooldownTestIn = (config: DependabotConfig, minimumReleaseAge: number) => {
  const tree = mkdtempSync(join(tmpdir(), "acceptance-441-"));
  trees.push(tree);
  cpSync(join(REPO_ROOT, "src"), join(tree, "src"), { recursive: true });
  for (const entry of ENTRIES_THE_TREE_SHARES) {
    symlinkSync(join(REPO_ROOT, entry), join(tree, entry));
  }
  mkdirSync(join(tree, ".github"));
  writeFileSync(join(tree, DEPENDABOT_YML), JSON.stringify(config));
  writeFileSync(join(tree, "bunfig.toml"), `[install]\nminimumReleaseAge = ${minimumReleaseAge}\n`);
  return spawnSync(process.execPath, ["test", `./${COOLDOWN_TEST}`], {
    cwd: tree,
    encoding: "utf8",
    env: shellEnv,
    timeout: SPAWN_TIMEOUT_MS,
  });
};

const bunUpdates = (config: DependabotConfig) =>
  config.updates.filter((update) => update["package-ecosystem"] === "bun");

describe("Dependabot の依存更新を bun の update にする (#441)", () => {
  test("AC-001: .github/dependabot.yml に、package-ecosystem が bun で directory が / の update がある", () => {
    expect(bunUpdates(readDependabot()).map((update) => update.directory)).toContain("/");
  });

  test('AC-002: .github/dependabot.yml に package-ecosystem: "npm" を書かない', () => {
    expect(gitGrep(`package-ecosystem:[[:space:]]*["']?npm["']?`, DEPENDABOT_YML)).toEqual([]);
  });

  test(
    "AC-003: bun の update の cooldown を minimumReleaseAge と違う日数にした tree では、dependabot-cooldown.test.ts が落ちる",
    () => {
      const minimumReleaseAge = readMinimumReleaseAge();
      const config = readDependabot();
      const updates = bunUpdates(config);
      expect(updates.length).toBeGreaterThan(0);
      for (const update of updates) {
        update.cooldown = { "default-days": minimumReleaseAge / SECONDS_PER_DAY + 1 };
      }

      const result = runCooldownTestIn(config, minimumReleaseAge);

      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-004: minimumReleaseAge を bun の update の cooldown と違う日数にした tree では、dependabot-cooldown.test.ts が落ちる",
    () => {
      const config = readDependabot();
      const cooldownDays = bunUpdates(config).map((update) => update.cooldown?.["default-days"]);
      expect(cooldownDays.length).toBeGreaterThan(0);
      expect(cooldownDays.every((days) => typeof days === "number")).toBe(true);

      const result = runCooldownTestIn(config, readMinimumReleaseAge() + SECONDS_PER_DAY);

      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-005: 今の dependabot.yml と minimumReleaseAge の tree では、dependabot-cooldown.test.ts が通る",
    () => {
      const result = runCooldownTestIn(readDependabot(), readMinimumReleaseAge());

      expect(result.error).toBeUndefined();
      expect(`${result.status}\n${result.stdout}${result.stderr}`).toStartWith("0\n");
    },
    SPAWN_TIMEOUT_MS,
  );

  test("AC-006: ADR-0009 に、security update と bun audit を同じ行で扱う段落がある", () => {
    const paragraphs = read(ADR_0009)
      .split("\n")
      .filter((line) => line.includes("security update") && line.includes("bun audit"));
    expect(paragraphs.length).toBeGreaterThan(0);
  });

  test('AC-007: ADR-0009 に package-ecosystem: "npm" と「npm の cooldown」を書かない', () => {
    expect(
      gitGrep(`package-ecosystem:[[:space:]]*["']?npm["']?|npm の .?cooldown`, ADR_0009),
    ).toEqual([]);
  });
});
