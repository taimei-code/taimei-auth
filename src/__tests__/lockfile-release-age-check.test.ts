import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexOfStepRunning, readWorkflow, REPO_ROOT } from "./config-invariant-helpers";

const CHECK_SCRIPT = "scripts/check-lockfile-release-age.ts";

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

const checkFromSubdirectoryWith = (minimumReleaseAge: string) => {
  const root = mkdtempSync(join(tmpdir(), "lockfile-release-age-"));
  repos.push(root);
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
  const root = mkdtempSync(join(tmpdir(), "lockfile-release-age-"));
  repos.push(root);
  const git = (...args: string[]) =>
    expect(
      spawnSync(
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
        { cwd: root },
      ).status,
    ).toBe(0);
  const lockWith = (packages: Record<string, readonly unknown[]>) =>
    writeFileSync(join(root, "bun.lock"), JSON.stringify({ lockfileVersion: 1, packages }));
  writeFileSync(
    join(root, "bunfig.toml"),
    `[install]\nminimumReleaseAge = 604800\nregistry = "${UNREACHABLE_REGISTRY}"\n`,
  );
  lockWith({});
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
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
