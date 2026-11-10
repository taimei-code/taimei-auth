import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_AUTH_SECRET, TEST_MFA_TOTP_ENCRYPTION_KEYS } from "./test-env";
import { REPO_ROOT } from "./source-scan";

const TEST_TITLE = /^\s*test(?:\.[a-z]+)?\(\s*["'`](.*)["'`],/gm;
const PATH_OR_CODE = /^`.*`$/;

const authScreenSection = (): string => {
  const glossary = readFileSync(join(REPO_ROOT, "GLOSSARY.md"), "utf8");
  const start = glossary.indexOf("### 認証画面");
  const next = glossary.indexOf("\n### ", start + 1);
  return glossary.slice(start, next === -1 ? undefined : next);
};

const canonicalScreenTerms = (): string[] =>
  [...authScreenSection().matchAll(/^\*\*(.+)\*\*:$/gm)].map(([, term = ""]) => term);

const avoidedScreenTerms = (): string[] =>
  [...authScreenSection().matchAll(/^_Avoid_: (.+)$/gm)]
    .flatMap(([, terms = ""]) => terms.split(", "))
    .map((term) => term.replace(/ \(.*\)$/, "").trim())
    .filter((term) => !PATH_OR_CODE.test(term));

describe("e2e の起動設定", () => {
  test("e2e サーバーの既定の暗号鍵は bun test の既定の鍵と同じ", () => {
    const script = readFileSync(join(REPO_ROOT, "e2e", "start-server.sh"), "utf8");
    const fallback = /MFA_TOTP_ENCRYPTION_KEYS:-([^}]+)\}/.exec(script)?.[1];
    expect(fallback).toBe(TEST_MFA_TOTP_ENCRYPTION_KEYS);
  });

  test("e2e サーバーの既定の AUTH_SECRET は bun test の既定の値と同じ", () => {
    const script = readFileSync(join(REPO_ROOT, "e2e", "start-server.sh"), "utf8");
    const fallback = /AUTH_SECRET:-([^}]+)\}/.exec(script)?.[1];
    expect(fallback).toBe(TEST_AUTH_SECRET);
  });

  test("e2e のファイル名は bun test が拾う形 (.test. / .spec. / _test. / _spec.) にしない", () => {
    const pickedByBunTest = readdirSync(join(REPO_ROOT, "e2e")).filter((name) =>
      /[._](test|spec)\.[cm]?[jt]sx?$/.test(name),
    );
    expect(pickedByBunTest).toEqual([]);
  });

  test("e2e の test 名は、GLOSSARY の認証画面の節が避ける語を使わない", () => {
    const avoidedTerms = avoidedScreenTerms();
    expect(avoidedTerms).toContain("ログイン画面");
    const canonicalTerms = canonicalScreenTerms();
    const misnamed = readdirSync(join(REPO_ROOT, "e2e"))
      .filter((name) => name.endsWith(".e2e.ts"))
      .flatMap((name) =>
        [...readFileSync(join(REPO_ROOT, "e2e", name), "utf8").matchAll(TEST_TITLE)].map(
          ([, title = ""]) => ({ name, title }),
        ),
      )
      .filter(({ title }) => {
        const withoutCanonical = canonicalTerms.reduce(
          (rest, canonical) => rest.replaceAll(canonical, ""),
          title,
        );
        return avoidedTerms.some((avoided) => withoutCanonical.includes(avoided));
      });
    expect(misnamed).toEqual([]);
  });
});
