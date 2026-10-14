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

function wranglerVarKeys(): string[] {
  const config = parseJsonc(readFileSync(join(REPO_ROOT, "wrangler.jsonc"), "utf8")) as unknown as {
    vars?: Record<string, unknown>;
  };
  return Object.keys(config.vars ?? {});
}

describe("scripts/wrangler-dev.sh の OVERRIDE_ALWAYS", () => {
  test("wrangler.jsonc の vars の key 集合と一致する", () => {
    expect(symmetricDifference(overrideAlways(), wranglerVarKeys())).toEqual([]);
  });
});
