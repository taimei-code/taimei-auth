import { describe, expect, test } from "bun:test";
import { posix } from "node:path";

import { grepFiles } from "./grep-files";
import { readActualWebSources } from "./web-domain-structure-helpers";

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

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

const usesEffectHook = (source: string) => /\buse(Layout)?Effect\b/.test(source);

const mayRunMutation = (path: string) =>
  path.endsWith("-atom.ts") || path === "shared/atom-runtime.ts";

type Rule = {
  readonly name: string;
  readonly violates: (path: string, source: string, imports: readonly string[]) => boolean;
};

const RULES: readonly Rule[] = [
  { name: "fetch", violates: (_path, source) => /\bfetch\(/.test(source) },
  {
    name: "SpaApiClient",
    violates: (path, _source, imports) =>
      imports.some((target) => target.endsWith("shared/spa-api-client")) &&
      !path.endsWith("-atom.ts"),
  },
  {
    name: "effect/http",
    violates: (path, _source, imports) =>
      imports.includes("effect/http") && !mayUseHttpClient(path),
  },
  {
    name: "useEffect",
    violates: (path, source) => path.includes("/pages/") && usesEffectHook(source),
  },
  {
    name: "promiseExit",
    violates: (path, source) => /\bpromiseExit\b/.test(source) && !mayRunMutation(path),
  },
];

const violationsOf = (path: string, source: string): string[] => {
  const imports = runtimeImports(path, source);
  return RULES.filter((rule) => rule.violates(path, source, imports)).map((rule) => rule.name);
};

function analyzeWebDataAccess(sources: Readonly<Record<string, string>>): string[] {
  const results: string[] = [];
  for (const [fullPath, source] of Object.entries(sources)) {
    const path = fullPath.replace(/^web\/src\//, "");
    if (path.includes("__tests__/") || !/\.tsx?$/.test(path)) continue;
    const violations = violationsOf(path, source);
    if (violations.length > 0) results.push(`${path}: ${violations.join(", ")}`);
  }
  return results.sort();
}

describe("web のデータの取得と更新は *-atom.ts の SpaApiClient だけ (ADR-0017)", () => {
  test("fetch は書かず、SpaApiClient と effect/http は *-atom.ts だけが使い、pages/ は useEffect を使わない", () => {
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

  test("失敗の _tag の判定は shared/failure-message.ts に集める", () => {
    const callers = grepFiles(String.raw`Cause\.findErrorOption`, "web/src", {
      include: ["*.ts", "*.tsx"],
      excludeTests: true,
    });
    expect(callers).toEqual(["web/src/shared/failure-message.ts"]);
  });

  test("更新の実行 (useAtomSet の promiseExit) は *-atom.ts の hook だけが書く", () => {
    expect(
      analyzeWebDataAccess({
        "web/src/company/AddCompanyDialog.tsx":
          'const add = useAtomSet(addCompanyAtom, { mode: "promiseExit" });',
      }),
    ).toEqual(["company/AddCompanyDialog.tsx: promiseExit"]);
  });

  test("名前が -api.ts で終わる file でも fetch を書くと落ちる", () => {
    expect(
      analyzeWebDataAccess({ "web/src/mfa/mfa-api.ts": 'export const f = () => fetch("/x");' }),
    ).toEqual(["mfa/mfa-api.ts: fetch"]);
  });

  test("route entry (pages/) が useEffect を import すると落ちる (遷移起点の処理は route の beforeLoad / loader)", () => {
    expect(
      analyzeWebDataAccess({
        "web/src/company/pages/X.tsx":
          'import { useEffect } from "react";\nexport const X = () => null;',
      }),
    ).toEqual(["company/pages/X.tsx: useEffect"]);
  });

  test.each([
    ["namespace の React.useEffect", 'import * as React from "react";\nReact.useEffect(() => {});'],
    ["useLayoutEffect", 'import { useLayoutEffect } from "react";\nuseLayoutEffect(() => {});'],
  ])("route entry (pages/) の %s も落ちる", (_name, source) => {
    expect(analyzeWebDataAccess({ "web/src/company/pages/X.tsx": source })).toEqual([
      "company/pages/X.tsx: useEffect",
    ]);
  });
});
