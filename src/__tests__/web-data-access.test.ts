import { describe, expect, test } from "bun:test";
import { posix } from "node:path";

import { grepFiles, valueImportsInSource } from "./source-scan";
import { readActualWebSources } from "./web-domain-structure-helpers";

const runtimeImports = (path: string, source: string): string[] =>
  valueImportsInSource(path, source).map((specifier) =>
    specifier.startsWith(".")
      ? posix.normalize(posix.join(posix.dirname(path), specifier))
      : specifier,
  );

const isFoldkitFile = (source: string) => /from\s+["']foldkit(\/[^"']*)?["']/.test(source);

const isApplicationEntry = (path: string) => /^app\/[^/]+\/entry\.ts$/.test(path);

type Rule = {
  readonly name: string;
  readonly violates: (path: string, source: string, imports: readonly string[]) => boolean;
};

const RULES: readonly Rule[] = [
  { name: "fetch", violates: (_path, source) => /\bfetch\(/.test(source) },
  {
    name: "SpaHttpClient",
    violates: (path, source, imports) =>
      imports.some((target) => target.endsWith("shared/spa-http-client")) &&
      !isFoldkitFile(source) &&
      !isApplicationEntry(path),
  },
  {
    name: "effect/http",
    violates: (_path, _source, imports) => imports.includes("effect/http"),
  },
  {
    name: "better-auth の読み出し",
    violates: (path, source) =>
      /\.(listSessions|listAccounts)\(/.test(source) && path !== "account/auth-client-read.ts",
  },
  {
    name: "SPA を離れる遷移",
    violates: (path, source) =>
      (/\blocation\.(replace|assign)\(|\blocation\.href\s*=(?!=)|\bNavigation\.load\(/.test(
        source,
      ) ||
        /import\s*\{[^}]*\bload\b[^}]*\}\s*from\s*["']foldkit\/navigation["']/.test(source)) &&
      path !== "shared/leave-spa.ts",
  },
  {
    name: "cause を捨てる onFailure",
    violates: (_path, source) =>
      /\bonFailure:\s*\(\s*(_\w*)?\s*\)\s*=>/.test(source) ||
      /\bEffect\.catch\(\s*\(\s*(_\w*)?\s*\)\s*=>|\borElseSucceed\b/.test(source),
  },
  {
    name: "sign-out",
    violates: (path, source) => /\.signOut\(/.test(source) && path !== "auth/sign-out.ts",
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

describe("web は通信と遷移と sign-out を決めた file だけが書く", () => {
  test("fetch と effect/http の値の import は書かず、Foldkit の SpaHttpClient は Foldkit の file と application の起動だけが使い、better-auth の一覧の読み出しは account/auth-client-read.ts、SPA を離れる遷移は shared/leave-spa.ts、sign-out は auth/sign-out.ts だけが書き、cause を捨てない", () => {
    expect(analyzeWebDataAccess(readActualWebSources())).toEqual([]);
  });

  test("失敗の _tag の判定は shared/failure-message.ts に集める", () => {
    const callers = grepFiles(String.raw`Cause\.findErrorOption`, "web/src", {
      tests: "exclude",
    });
    expect(callers).toEqual(["web/src/shared/failure-message.ts"]);
  });

  test("画面は失敗の cause を捨てない", () => {
    expect(
      analyzeWebDataAccess({
        "web/src/company/pages/Companies.ts":
          "Exit.match(exit, { onSuccess: () => 1, onFailure: () => 0 });",
      }),
    ).toEqual(["company/pages/Companies.ts: cause を捨てる onFailure"]);
  });

  test("名前が -api.ts で終わる file でも fetch を書くと落ちる", () => {
    expect(
      analyzeWebDataAccess({ "web/src/mfa/mfa-api.ts": 'export const f = () => fetch("/x");' }),
    ).toEqual(["mfa/mfa-api.ts: fetch"]);
  });
});
