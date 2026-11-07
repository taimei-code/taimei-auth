import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const FOLDKIT_REFERENCE = /https:\/\/github\.com\/foldkit\/foldkit\/tree\/foldkit@([^\s)`]+)/g;

const readRepoFile = (file: string) => readFileSync(path.join(REPO_ROOT, file), "utf8");

const PackageJson = Schema.fromJsonString(
  Schema.Struct({ devDependencies: Schema.Struct({ foldkit: Schema.String }) }),
);

const installedFoldkitVersion = () =>
  Schema.decodeSync(PackageJson)(readRepoFile("package.json")).devDependencies.foldkit;

const referencedFoldkitVersions = (claudeMd: string) =>
  [...claudeMd.matchAll(FOLDKIT_REFERENCE)].map(([, version]) => version);

describe("agent が読む Foldkit の参照は、入れた版と一致する", () => {
  test("package.json の foldkit は範囲を持たない版で固定する", () => {
    expect(installedFoldkitVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("web/src/CLAUDE.md の Foldkit の参照は、入れた版の tag だけを指す", () => {
    expect(referencedFoldkitVersions(readRepoFile("web/src/CLAUDE.md"))).toEqual([
      installedFoldkitVersion(),
    ]);
  });

  test.each([
    "FOLDKIT.md",
    "web/FOLDKIT.md",
    "web/.mcp.json",
  ])("Foldkit の scaffold が置く %s を repo に持ち込まない", (file) => {
    expect(existsSync(path.join(REPO_ROOT, file))).toBe(false);
  });

  test("repo の .mcp.json に Foldkit の DevTools の MCP server を足さない", () => {
    expect(readRepoFile(".mcp.json")).not.toMatch(/foldkit/i);
  });
});
