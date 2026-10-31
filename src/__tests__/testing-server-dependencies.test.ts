import { describe, expect, test } from "bun:test";
import { disallowedImportsReachableFrom } from "./source-scan";
import { readPackageJson } from "./config-invariant-helpers";

const TESTING_SERVER_ENTRIES = [
  "testing/worker.ts",
  "testing/staging-worker.ts",
  "testing/server.ts",
];

const packageNameOf = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

const isRuntimeBuiltin = (specifier: string) =>
  specifier.startsWith("node:") || specifier.startsWith("cloudflare:");

describe("本番以外の server の entry から辿れる import は dependencies に閉じる", () => {
  test("外部パッケージの runtime import は package.json の dependencies だけ (画面の React と shadcn の部品は web の build で bundle し、server からは import しない。docs/adr/0014-docker-runner-dev-stage-separation.md)", () => {
    const dependencies = new Set(Object.keys(readPackageJson().dependencies ?? {}));

    expect(
      disallowedImportsReachableFrom(
        TESTING_SERVER_ENTRIES,
        (specifier) => isRuntimeBuiltin(specifier) || dependencies.has(packageNameOf(specifier)),
      ),
    ).toEqual([]);
  });
});
