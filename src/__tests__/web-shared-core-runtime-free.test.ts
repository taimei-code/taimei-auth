import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT, sourceFiles, valueImportsOf } from "./source-scan";

const BROWSER_SAFE_PACKAGES = new Set(["zod", "effect", "effect/http-api"]);

function coreFilesImportedFromWeb(): string[] {
  const modules = new Set<string>();
  for (const file of sourceFiles("web/src").map((path) => join(REPO_ROOT, path))) {
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(/from\s+["']@core\/([^"']+)["']/g)) {
      modules.add(m[1] as string);
    }
  }
  return [...modules].map((mod) => join(REPO_ROOT, "src", `${mod}.ts`));
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = join(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

describe("web と共有する @core file の依存クロージャは browser-safe に閉じる", () => {
  test("外部パッケージの runtime import は allowlist のみ (相対 import は推移的に検査。allowlist に足すのは browser で動き、secrets と I/O を持たない package だけ)", () => {
    const queue = coreFilesImportedFromWeb();
    expect(queue.length).toBeGreaterThan(0);

    const seen = new Set(queue);
    const violations: { file: string; specifier: string }[] = [];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      for (const specifier of valueImportsOf(file)) {
        if (specifier.startsWith(".")) {
          const resolved = resolveRelative(file, specifier);
          if (resolved === null) {
            violations.push({ file, specifier });
          } else if (!seen.has(resolved)) {
            seen.add(resolved);
            queue.push(resolved);
          }
        } else if (!BROWSER_SAFE_PACKAGES.has(specifier)) {
          violations.push({ file, specifier });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
