import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

const SEALED_TEST = "acceptance/release-age-excludes-dialog-animation.test.ts";
const BUNFIG = "bunfig.toml";
const ENTRIES_THE_COPY_OWNS = new Set([".git", "acceptance", BUNFIG]);

const SPAWN_TIMEOUT_MS = 120_000;

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

const EXCLUDED_BY_383 = [
  "effect",
  "@effect/platform-bun",
  "@effect/platform-node",
  "@effect/platform-node-shared",
  "alchemy",
  "@alchemy.run/cloudflare",
  "@alchemy.run/acme",
  "@alchemy.run/cloudflare-runtime",
  "@alchemy.run/docker",
  "@alchemy.run/node-utils",
  "@alchemy.run/sql",
  "@distilled.cloud/acme",
  "@distilled.cloud/aws",
  "@distilled.cloud/aws4signer",
  "@distilled.cloud/cloudflare",
  "@distilled.cloud/core",
  "@distilled.cloud/iceberg",
];
const EXCLUDED_BY_388 = "@effect/platform-browser";
const EXCLUDED_UNTIL_385 = [...EXCLUDED_BY_383, EXCLUDED_BY_388];

const ONE_HUNDRED_YEARS_IN_SECONDS = 3_153_600_000;

const GIT_GREP_FAILED = 2;
const GIT_NOT_A_REPOSITORY = 128;

const onePackagePerLine = (packages: readonly string[]) =>
  ["minimumReleaseAgeExcludes = [", ...packages.map((name) => `  "${name}",`), "]"].join("\n");

const allPackagesOnOneLine = (packages: readonly string[]) =>
  `minimumReleaseAgeExcludes = [${packages.map((name) => `"${name}"`).join(", ")}]`;

const rewriteMinimumReleaseAgeLine = (rewrite: (line: string) => string) => (bunfig: string) => {
  const rewritten = bunfig.replace(/^minimumReleaseAge = .*$/m, rewrite);
  if (rewritten === bunfig) {
    throw new Error("bunfig.toml の minimumReleaseAge の行を書き換えられなかった");
  }
  return rewritten;
};

const withExcludes = (excludes: string) =>
  rewriteMinimumReleaseAgeLine((line) => `${line}\n${excludes}`);

const withMinimumReleaseAge = (seconds: number) =>
  rewriteMinimumReleaseAgeLine(() => `minimumReleaseAge = ${seconds}`);

const unchanged = (bunfig: string) => bunfig;

const runSealedTest = (
  root: string,
  acIds: readonly string[],
  env: NodeJS.ProcessEnv = shellEnv,
) => {
  const ran = spawnSync("bun", ["test", SEALED_TEST, "-t", acIds.join("|")], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: SPAWN_TIMEOUT_MS,
  });
  return {
    passed: ran.status === 0,
    failedAcIds: [...`${ran.stdout}${ran.stderr}`.matchAll(/^\(fail\) .* > (AC-\d{3}):/gm)].map(
      (failure) => failure[1],
    ),
  };
};

const inTreeWithBunfig = <Observed>(
  rewriteBunfig: (bunfig: string) => string,
  observe: (root: string) => Observed,
): Observed => {
  const root = mkdtempSync(join(tmpdir(), "taimei-auth-436-tree-"));
  try {
    for (const entry of readdirSync(REPO_ROOT)) {
      if (!ENTRIES_THE_COPY_OWNS.has(entry)) {
        symlinkSync(join(REPO_ROOT, entry), join(root, entry));
      }
    }
    mkdirSync(join(root, "acceptance"));
    copyFileSync(join(REPO_ROOT, SEALED_TEST), join(root, SEALED_TEST));
    writeFileSync(
      join(root, BUNFIG),
      rewriteBunfig(readFileSync(join(REPO_ROOT, BUNFIG), "utf8")),
    );
    const initialized = spawnSync("git", ["init", "--quiet"], {
      cwd: root,
      encoding: "utf8",
      env: shellEnv,
    });
    if (initialized.status !== 0) {
      throw new Error(`git init に失敗した\n${initialized.stderr}`);
    }
    return observe(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const withGitExiting = <Observed>(
  status: number,
  observe: (env: NodeJS.ProcessEnv) => Observed,
): Observed => {
  const bin = mkdtempSync(join(tmpdir(), "taimei-auth-436-git-"));
  try {
    writeFileSync(join(bin, "git"), `#!/bin/sh\nexit ${status}\n`, { mode: 0o755 });
    return observe({ ...shellEnv, PATH: `${bin}${delimiter}${shellEnv.PATH}` });
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
};

const SEALED_AC_001_FAILED = { passed: false, failedAcIds: ["AC-001"] };
const SEALED_AC_001_AND_AC_008_FAILED = { passed: false, failedAcIds: ["AC-001", "AC-008"] };
const NOTHING_FAILED = { passed: true, failedAcIds: [] };

describe("#385・#424 の封済みの受け入れテストが見分けるもの (#436)", () => {
  test(
    "AC-001: #385 が外した 18 個を 1 行に 1 個の書式で書き戻すと、封済みの AC-001 が落ちる",
    () => {
      const observed = inTreeWithBunfig(
        withExcludes(onePackagePerLine(EXCLUDED_UNTIL_385)),
        (root) => runSealedTest(root, ["AC-001"]),
      );
      expect(observed).toEqual(SEALED_AC_001_FAILED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-001: #385 が外した 18 個を 1 行に並べて書き戻すと、封済みの AC-001 が落ちる",
    () => {
      const observed = inTreeWithBunfig(
        withExcludes(allPackagesOnOneLine(EXCLUDED_UNTIL_385)),
        (root) => runSealedTest(root, ["AC-001"]),
      );
      expect(observed).toEqual(SEALED_AC_001_FAILED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-002: @effect/platform-browser だけを 1 行に 1 個の書式で書くと、封済みの AC-001 が落ちる",
    () => {
      const observed = inTreeWithBunfig(
        withExcludes(onePackagePerLine([EXCLUDED_BY_388])),
        (root) => runSealedTest(root, ["AC-001"]),
      );
      expect(observed).toEqual(SEALED_AC_001_FAILED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-002: @effect/platform-browser だけを 1 行で書くと、封済みの AC-001 が落ちる",
    () => {
      const observed = inTreeWithBunfig(
        withExcludes(allPackagesOnOneLine([EXCLUDED_BY_388])),
        (root) => runSealedTest(root, ["AC-001"]),
      );
      expect(observed).toEqual(SEALED_AC_001_FAILED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-003: git が status 2 で終わると、封済みの AC-001 と AC-008 が落ちる",
    () => {
      const observed = withGitExiting(GIT_GREP_FAILED, (env) =>
        runSealedTest(REPO_ROOT, ["AC-001", "AC-008"], env),
      );
      expect(observed).toEqual(SEALED_AC_001_AND_AC_008_FAILED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-003: git が status 128 で終わると、封済みの AC-001 と AC-008 が落ちる",
    () => {
      const observed = withGitExiting(GIT_NOT_A_REPOSITORY, (env) =>
        runSealedTest(REPO_ROOT, ["AC-001", "AC-008"], env),
      );
      expect(observed).toEqual(SEALED_AC_001_AND_AC_008_FAILED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-004: 固定した版がどれも minimumReleaseAge を満たせない bunfig.toml では、封済みの AC-002 は通らない",
    () => {
      const observed = inTreeWithBunfig(
        withMinimumReleaseAge(ONE_HUNDRED_YEARS_IN_SECONDS),
        (root) => ({
          sealedAc001: runSealedTest(root, ["AC-001"]),
          sealedAc002Passed: runSealedTest(root, ["AC-002"]).passed,
        }),
      );
      expect(observed).toEqual({ sealedAc001: NOTHING_FAILED, sealedAc002Passed: false });
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-005: 今の repo では、封済みの AC-001 と AC-008 が通る",
    () => {
      expect(runSealedTest(REPO_ROOT, ["AC-001", "AC-008"])).toEqual(NOTHING_FAILED);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "AC-005: bunfig.toml を変えずに写した tree では、封済みの AC-001 が通る",
    () => {
      const observed = inTreeWithBunfig(unchanged, (root) => runSealedTest(root, ["AC-001"]));
      expect(observed).toEqual(NOTHING_FAILED);
    },
    SPAWN_TIMEOUT_MS,
  );
});
