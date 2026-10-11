import { describe, expect, test } from "bun:test";
import { posix } from "node:path";

import { grepFiles } from "./grep-files";
import { readActualWebSources } from "./web-domain-structure-helpers";

const UNMIGRATED: ReadonlySet<string> = new Set([
  // router を差し替える時に loader へ移すまで残す (理由は ADR-0017「web への拡大」節)
  "mfa/use-mfa-challenge-flow.ts",
]);

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

// scanImports は import type と type だけの import を返さない
const runtimeImports = (path: string, source: string): string[] =>
  (path.endsWith(".tsx") ? transpilers.tsx : transpilers.ts)
    .scanImports(source)
    .map((entry) => entry.path)
    .map((specifier) =>
      specifier.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(path), specifier))
        : specifier,
    );

const mayUseHttpClient = (path: string) =>
  path.endsWith("-atom.ts") || path === "shared/spa-api-client.ts";

const violationsOf = (path: string, source: string): string[] => {
  const imports = runtimeImports(path, source);
  return [
    ...(/\bfetch\(/.test(source) && !path.endsWith("-api.ts") ? ["fetch"] : []),
    ...(imports.some((target) => target.endsWith("-api")) ? ["*-api"] : []),
    ...(imports.some((target) => target.endsWith("shared/spa-api-client")) &&
    !path.endsWith("-atom.ts")
      ? ["SpaApiClient"]
      : []),
    ...(imports.includes("effect/http") && !mayUseHttpClient(path) ? ["effect/http"] : []),
  ];
};

function analyzeWebDataAccess(sources: Readonly<Record<string, string>>): string[] {
  const results: string[] = [];
  const violating = new Set<string>();
  for (const [fullPath, source] of Object.entries(sources)) {
    const path = fullPath.replace(/^web\/src\//, "");
    if (path.includes("__tests__/") || !/\.tsx?$/.test(path)) continue;
    const violations = violationsOf(path, source);
    if (violations.length === 0) continue;
    violating.add(path);
    if (!UNMIGRATED.has(path)) results.push(`${path}: ${violations.join(", ")}`);
  }
  for (const path of UNMIGRATED) {
    if (!violating.has(path)) results.push(`${path}: 許可リストにあるが違反していない`);
  }
  return results.sort();
}

describe("web のデータの取得と更新は *-atom.ts の SpaApiClient だけ (ADR-0017)", () => {
  test("fetch は *-api.ts、*-api は許可リスト、SpaApiClient と effect/http は *-atom.ts だけが使う", () => {
    expect(analyzeWebDataAccess(readActualWebSources())).toEqual([]);
  });

  test("reactivityKeys を書けるのは *-atom.ts だけ (一覧を変える更新は key を足した hook で渡す)", () => {
    const writers = grepFiles(String.raw`reactivityKeys:`, "web/src", {
      include: ["*.ts", "*.tsx"],
      excludeTests: true,
    });
    expect(writers.filter((path) => !path.endsWith("-atom.ts"))).toEqual([]);
  });

  test("前回の成功値の有無は shared/atom-runtime.ts の failedBeforeAnyValue だけが読む", () => {
    const readers = grepFiles(String.raw`previousSuccess`, "web/src", {
      include: ["*.ts", "*.tsx"],
      excludeTests: true,
    });
    expect(readers).toEqual(["web/src/shared/atom-runtime.ts"]);
  });

  test("失敗の _tag の判定は shared/failure-message.ts と MFA の読み替えに集める", () => {
    const callers = grepFiles(String.raw`Cause\.findErrorOption`, "web/src", {
      include: ["*.ts", "*.tsx"],
      excludeTests: true,
    });
    expect(callers.sort()).toEqual([
      "web/src/mfa/mfa-atom.ts",
      "web/src/shared/failure-message.ts",
    ]);
  });
});
