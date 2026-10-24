import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { disallowedImportsReachableFrom, REPO_ROOT, sourceFiles } from "./source-scan";

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

describe("web と共有する @core file の依存クロージャは browser-safe に閉じる", () => {
  test("外部パッケージの runtime import は allowlist のみ (相対 import は推移的に検査。allowlist に足すのは browser で動き、secrets と I/O を持たない package だけ)", () => {
    const coreFiles = coreFilesImportedFromWeb();
    expect(coreFiles.length).toBeGreaterThan(0);

    const violations = disallowedImportsReachableFrom(coreFiles, (specifier) =>
      BROWSER_SAFE_PACKAGES.has(specifier),
    );
    expect(violations).toEqual([]);
  });
});
