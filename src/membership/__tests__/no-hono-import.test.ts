import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Guard 層 (src/membership/guard/*.ts / policy.ts) と invitation accept use-case
// (src/invitation/accept.ts) が hono を直接 import しないことを静的に固定する。Transport 層の
// hono を内側で握らないことで、identity DB を将来 RPC 化する際に Guard/Use-case ごと差し替えられる
// 4 層境界 (ADR-0012 参照) を CI で保つ。対象は当該 file の `from "hono"` 直接 import に限定し、
// `../auth` 経由の推移的依存は範囲外 (Guard 層内で hono を握らないことが本質)。
// test 自身が hono を import すると self-hit するため grep は execSync でシェル外に投げる。

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
      // grep -l で hit したファイルを一覧化。無 hit なら stdout 空・exit 1、有 hit なら exit 0。
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
