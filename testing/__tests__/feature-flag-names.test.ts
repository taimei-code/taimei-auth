import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Record } from "effect";
import { FEATURE_FLAG_CATALOG } from "../feature-flag-catalog";

const REPO_ROOT = join(import.meta.dir, "../..");

const UNREGISTERED_FLAG = "pass-key";

const TYPECHECK_TIMEOUT_MS = 30_000;

const REGISTERED_FLAGS = Record.keys(FEATURE_FLAG_CATALOG);

const switches = (receiver: string, flag: string) => {
  const name = JSON.stringify(flag);
  return [
    `${receiver}.on(${name});`,
    `${receiver}.off(${name});`,
    `${receiver}.onlyFor(${name}, ["listed"]);`,
  ];
};

const fakeSwitches = (flag: string) => [
  ...switches("fake", flag),
  `fake.remove(${JSON.stringify(flag)});`,
];

const helperSwitches = (flag: string) => switches("helper", flag);

const PROBED_CALLS = [
  ...fakeSwitches(UNREGISTERED_FLAG),
  ...helperSwitches(UNREGISTERED_FLAG),
  ...REGISTERED_FLAGS.flatMap((flag) => [...fakeSwitches(flag), ...helperSwitches(flag)]),
];

const probeDirectories: string[] = [];

afterAll(() => {
  for (const directory of probeDirectories) rmSync(directory, { recursive: true, force: true });
});

const typecheckProbedCalls = () => {
  const probeDirectory = mkdtempSync(join(tmpdir(), "feature-flag-names-"));
  probeDirectories.push(probeDirectory);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(probeDirectory, "node_modules"));
  const header = [
    `import type { APIRequestContext } from "@playwright/test";`,
    `import { featureFlags } from ${JSON.stringify(join(REPO_ROOT, "e2e/helpers"))};`,
    `import { fakeFlagship } from ${JSON.stringify(join(REPO_ROOT, "testing/feature-flags"))};`,
    `declare const request: APIRequestContext;`,
    `export const switchEveryFlag = () => {`,
    `  const fake = fakeFlagship();`,
    `  const helper = featureFlags(request);`,
  ];
  writeFileSync(
    join(probeDirectory, "fixture.ts"),
    [...header, ...PROBED_CALLS, "};", ""].join("\n"),
  );
  writeFileSync(
    join(probeDirectory, "tsconfig.json"),
    JSON.stringify({
      extends: join(REPO_ROOT, "testing/tsconfig.json"),
      include: ["fixture.ts", join(REPO_ROOT, "worker-configuration.d.ts")],
    }),
  );
  const effectTsgo = spawnSync(join(REPO_ROOT, "node_modules/.bin/effect-tsgo"), ["get-exe-path"], {
    encoding: "utf8",
    timeout: TYPECHECK_TIMEOUT_MS,
  }).stdout.trim();
  const result = spawnSync(effectTsgo, ["--noEmit", "--pretty", "false", "-p", "tsconfig.json"], {
    cwd: probeDirectory,
    encoding: "utf8",
    timeout: TYPECHECK_TIMEOUT_MS,
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.error !== undefined || result.status === null) {
    throw new Error(`型検査が走らなかった: ${result.error?.message ?? result.signal}`);
  }
  const codesByLine = new Map<number, string[]>();
  for (const [, line, code] of output.matchAll(/^fixture\.ts\((\d+),\d+\): error (TS\d+)/gm)) {
    codesByLine.set(Number(line), [...(codesByLine.get(Number(line)) ?? []), code]);
  }
  const lineOf = (index: number) => header.length + index + 1;
  const callLines = new Set(PROBED_CALLS.map((_, index) => lineOf(index)));
  if ([...codesByLine.keys()].some((line) => !callLines.has(line))) {
    throw new Error(`fixture の切り替えの呼び出しの外に型のエラーがある:\n${output}`);
  }
  return new Map(PROBED_CALLS.map((call, index) => [call, codesByLine.get(lineOf(index)) ?? []]));
};

let probed: Map<string, string[]> | undefined;

const errorCodesByCall = (calls: readonly string[]) => {
  const codesByCall = (probed ??= typecheckProbedCalls());
  return calls.map((call) => [call, codesByCall.get(call)]);
};

describe("テストでフィーチャーフラグを切り替える関数は、一覧に登録した名前だけを受ける", () => {
  test("偽物の全体 on、全体 off、事業所だけ on、flag を無くす関数に、登録していない名前を渡すと、呼び出しごとに型検査で落ちる", () => {
    const calls = fakeSwitches(UNREGISTERED_FLAG);

    expect(errorCodesByCall(calls)).toEqual(calls.map((call) => [call, ["TS2345"]]));
  }, 60_000);

  test("E2E の helper の全体 on、全体 off、事業所だけ on に、登録していない名前を渡すと、呼び出しごとに型検査で落ちる", () => {
    const calls = helperSwitches(UNREGISTERED_FLAG);

    expect(errorCodesByCall(calls)).toEqual(calls.map((call) => [call, ["TS2345"]]));
  }, 60_000);

  test("一覧にあるどの名前も、偽物の切り替えの関数と E2E の helper に渡すと、型検査を通る", () => {
    const calls = REGISTERED_FLAGS.flatMap((flag) => [
      ...fakeSwitches(flag),
      ...helperSwitches(flag),
    ]);

    expect(errorCodesByCall(calls)).toEqual(calls.map((call) => [call, []]));
  }, 60_000);
});
