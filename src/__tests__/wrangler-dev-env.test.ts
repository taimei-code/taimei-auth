import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc, REPO_ROOT, symmetricDifference } from "./config-invariant-helpers";

function overrideAlways(): string[] {
  const script = readFileSync(join(REPO_ROOT, "scripts/wrangler-dev.sh"), "utf8");
  const match = script.match(/OVERRIDE_ALWAYS=\(([^)]*)\)/);
  if (!match) throw new Error("OVERRIDE_ALWAYS=( ... ) が scripts/wrangler-dev.sh に無い");
  return match[1].split(/\s+/).filter((k) => k.length > 0);
}

function wranglerVarKeys(configPath: string): string[] {
  const config = parseJsonc(readFileSync(join(REPO_ROOT, configPath), "utf8")) as unknown as {
    vars?: Record<string, unknown>;
  };
  return Object.keys(config.vars ?? {});
}

describe("scripts/wrangler-dev.sh の OVERRIDE_ALWAYS (wrangler dev は process の環境変数を binding にしないので、vars を空でも上書きしないと本番の値が local に漏れる)", () => {
  test.each([
    "wrangler.jsonc",
    "testing/wrangler.jsonc",
  ])("%s の vars の key 集合と一致する", (configPath) => {
    expect(symmetricDifference(overrideAlways(), wranglerVarKeys(configPath))).toEqual([]);
  });
});
