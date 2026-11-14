import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./config-invariant-helpers";

const CHECK_SCRIPT = "scripts/check-lockfile-release-age.ts";

const repos: string[] = [];
afterAll(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
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
