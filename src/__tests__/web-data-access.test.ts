import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { grepFiles, REPO_ROOT, valueImportsInSource } from "./source-scan";
import { readActualWebSources } from "./web-domain-structure-helpers";

const runtimeImports = (path: string, source: string): string[] =>
  valueImportsInSource(path, source).map((specifier) =>
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
  {
    name: "better-auth の読み出し",
    violates: (path, source) =>
      /\bauthClient\.(listSessions|listAccounts)\(/.test(source) && !path.endsWith("-atom.ts"),
  },
  {
    name: "SPA を離れる遷移",
    violates: (path, source) =>
      /\blocation\.(replace|assign)\(|\blocation\.href\s*=(?!=)/.test(source) &&
      path !== "shared/leave-spa.ts",
  },
  {
    name: "cause を捨てる onFailure",
    violates: (path, source) =>
      /\bonFailure:\s*\(\s*(_\w*)?\s*\)\s*=>/.test(source) && !path.endsWith("-atom.ts"),
  },
  {
    name: "sign-out",
    violates: (path, source) =>
      /\bauthClient\.signOut\(/.test(source) && path !== "auth/sign-out.ts",
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
  test("fetch は書かず、SpaApiClient と effect/http と better-auth の読み出しは *-atom.ts だけが使い、pages/ は useEffect を使わず、SPA を離れる遷移は shared/leave-spa.ts、sign-out は auth/sign-out.ts だけが書く", () => {
    expect(analyzeWebDataAccess(readActualWebSources())).toEqual([]);
  });

  test("reactivityKeys を書けるのは *-atom.ts だけ (一覧を変える更新は key を足した hook で渡す)", () => {
    const writers = grepFiles("reactivityKeys:", "web/src", {
      tests: "exclude",
    });
    expect(writers.filter((path) => !path.endsWith("-atom.ts"))).toEqual([]);
  });

  test("MFA の状態の query と無効化は同じ MFA_STATUS_KEY を付け、有効化は reactivityKeys を付けない (有効化の直後に取り直すと、リカバリーコードが画面から消える)", () => {
    const source = readFileSync(join(REPO_ROOT, "web/src/mfa/mfa-atom.ts"), "utf8");
    const activate = source.slice(
      source.indexOf("export const useActivateMfa"),
      source.indexOf("export const useDisableMfa"),
    );
    expect(source.match(/reactivityKeys: \[MFA_STATUS_KEY\]/g)).toHaveLength(2);
    expect(source.match(/reactivityKeys/g)).toHaveLength(2);
    expect(activate).toContain("activate({ payload })");
    expect(activate).not.toContain("reactivityKeys");
  });

  test("前回の成功値の有無は shared/atom-runtime.ts の failedBeforeAnyValue だけが読む", () => {
    const readers = grepFiles("previousSuccess", "web/src", {
      tests: "exclude",
    });
    expect(readers).toEqual(["web/src/shared/atom-runtime.ts"]);
  });

  test("失敗の _tag の判定は shared/failure-message.ts に集める", () => {
    const callers = grepFiles(String.raw`Cause\.findErrorOption`, "web/src", {
      tests: "exclude",
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

  test("画面と hook は mutation の失敗の cause を捨てず、query を観測する *-atom.ts だけが捨ててよい", () => {
    const discard = "Exit.match(exit, { onSuccess: () => 1, onFailure: () => 0 });";
    expect(
      analyzeWebDataAccess({
        "web/src/company/AddCompanyDialog.tsx": discard,
        "web/src/company/company-atom.ts": discard,
      }),
    ).toEqual(["company/AddCompanyDialog.tsx: cause を捨てる onFailure"]);
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
