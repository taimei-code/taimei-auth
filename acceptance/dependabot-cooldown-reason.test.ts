import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] =>
  spawnSync("git", ["grep", "-n", "-E", "--untracked", pattern, "--", ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: shellEnv,
  })
    .stdout.split("\n")
    .filter((line) => line !== "");

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

interface DependabotConfig {
  updates: ReadonlyArray<{
    "package-ecosystem": string;
    cooldown?: { "default-days"?: number };
  }>;
}

describe("Dependabot の cooldown の説明 (#435)", () => {
  test("AC-001: .github/dependabot.yml に「install で落ちる」という説明を書かない", () => {
    expect(gitGrep("install で落ちる", ".github/dependabot.yml")).toEqual([]);
  });

  test("AC-002: ADR-0009 に、dependabot.yml の cooldown を 7 日にした理由を述べる段落がある", () => {
    const paragraphs = read("docs/adr/0009-supply-chain-hardening.md")
      .split("\n")
      .filter((paragraph) =>
        ["dependabot.yml", "cooldown", "7 日"].every((topic) => paragraph.includes(topic)),
      );
    expect(paragraphs.length).toBeGreaterThan(0);
  });

  test("AC-003: .github/dependabot.yml の npm の cooldown は 7 日のままである", () => {
    const config = Bun.YAML.parse(read(".github/dependabot.yml")) as DependabotConfig;
    const npmCooldownDays = config.updates
      .filter((update) => update["package-ecosystem"] === "npm")
      .map((update) => update.cooldown?.["default-days"]);
    expect(npmCooldownDays.length).toBeGreaterThan(0);
    expect(npmCooldownDays.every((days) => days === 7)).toBe(true);
  });
});
