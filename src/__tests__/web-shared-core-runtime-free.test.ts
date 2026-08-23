import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// web が @core alias で読む server 実装 (sign-in-params / role-label / policy 等) の依存
// クロージャに server 専用の runtime import (db / drizzle / resend / hono 等) が入ると、
// SPA bundle へ引き込まれるが typecheck / lint / build:web はいずれも exit 0 のまま気づけない
// (CLAUDE.md「リポジトリ共通規則」の build 設定 path 解決と同型の silent failure)。web/src の @core import から共有ファイル集合を
// 動的に導出し、相対 import を推移的に辿った全ファイルについて「外部パッケージの runtime
// import は browser-safe allowlist のみ」を CI で固定する (allowlist 外は fail-closed で違反)。

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_SRC = join(REPO_ROOT, "web/src");

// 共有クロージャ内で runtime import してよい外部パッケージ。増やすときは
// browser で動作すること・secrets や I/O を持たないことを確認して意識的に追加する。
const BROWSER_SAFE_PACKAGES = new Set(["zod"]);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

function coreFilesImportedFromWeb(): string[] {
  const modules = new Set<string>();
  for (const file of walk(WEB_SRC)) {
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(/from\s+["']@core\/([^"']+)["']/g)) {
      modules.add(m[1] as string);
    }
  }
  return [...modules].map((mod) => join(REPO_ROOT, "src", `${mod}.ts`));
}

// import / export 宣言の from 句を statement 単位で拾う (複数行 import にも一致する)。
const IMPORT_FROM = /(?:^|\n)\s*(import|export)\s+(type\b)?[^'"]*?from\s*["']([^"']+)["']/g;

function runtimeImportSpecifiers(content: string): string[] {
  return [...content.matchAll(IMPORT_FROM)]
    .filter(([, , typeOnly]) => !typeOnly)
    .map(([, , , specifier]) => specifier as string);
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = join(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

describe("web と共有する @core file の依存クロージャは browser-safe に閉じる", () => {
  test("外部パッケージの runtime import は allowlist のみ (相対 import は推移的に検査)", () => {
    const queue = coreFilesImportedFromWeb();
    expect(queue.length).toBeGreaterThan(0);

    const seen = new Set(queue);
    const violations: { file: string; specifier: string }[] = [];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      const content = readFileSync(file, "utf8");
      for (const specifier of runtimeImportSpecifiers(content)) {
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
