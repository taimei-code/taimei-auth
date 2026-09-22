import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// テスト自身が hono を import すると自分に一致するため、grep はシェルに任せる。

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const guardDir = join(REPO_ROOT, "src/membership/guard");
const policyFile = join(REPO_ROOT, "src/membership/policy.ts");
const acceptFile = join(REPO_ROOT, "src/invitation/accept.ts");

function listGuardFiles(): string[] {
  const files: string[] = [];
  for (const name of readdirSync(guardDir)) {
    const full = join(guardDir, name);
    if (statSync(full).isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      files.push(full);
    }
  }
  return files;
}

describe("Guard 層は hono を直接 import しない", () => {
  test('QA-R-07 guard/*.ts / policy.ts / accept.ts に `from "hono"` が無い', () => {
    const targets = [...listGuardFiles(), policyFile, acceptFile];
    expect(targets.length).toBeGreaterThan(0);

    for (const file of targets) {
      // grep は一致なしで exit 1 になる。
      let hit = "";
      try {
        hit = execSync(`grep -lE 'from[[:space:]]+["\\x27]hono["\\x27]' ${JSON.stringify(file)}`, {
          encoding: "utf8",
        }).trim();
      } catch (_) {
        hit = "";
      }
      expect({ file, hit }).toEqual({ file, hit: "" });
    }
  });
});
