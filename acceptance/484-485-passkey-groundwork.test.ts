import { describe, expect, test } from "bun:test";
import { adrFiles, readRepoText } from "./harness/repo-text";
import { stoppingLintCodes } from "./harness/lint-probe";

const ISSUE_SESSION_CALL = "export const r = (api: { issueSession(): void }) => api.issueSession();";

const passkeyAdrs = () =>
  adrFiles().filter((path) => /^# .*パスキー/m.test(readRepoText(path).split("\n", 1)[0] ?? ""));

describe("パスキーの判断と用語の文書", () => {
  test("docs/adr に、題にパスキーを含む ADR がちょうど 1 本ある", () => {
    expect(passkeyAdrs()).toHaveLength(1);
  });

  test("パスキーの ADR は自前の実装、検証の library、RP ID と origin、challenge、MFA チャレンジ、採らなかった plugin と親 domain を扱う", () => {
    const adrs = passkeyAdrs();
    expect(adrs).not.toEqual([]);
    const adr = adrs.map(readRepoText).join("\n");
    for (const topic of ["passkey plugin", "@simplewebauthn/server", "RP ID", "origin", "challenge", "MFA チャレンジ", "親 domain"]) {
      expect(adr).toContain(topic);
    }
    expect(adr).toMatch(/^## Considered Options$/m);
  });

  test("GLOSSARY.md にパスキーの項があり、避ける語を挙げている", () => {
    const glossary = readRepoText("GLOSSARY.md");
    const entry = /^\*\*パスキー\*\*:\n(?:.+\n)*?_Avoid_: .+$/m.exec(glossary);
    expect(entry).not.toBeNull();
  });
});

describe("session を発行してよい場所", () => {
  test("MFA チャレンジの通過の file で AuthApi.issueSession を呼ぶと lint が止める", () => {
    expect(stoppingLintCodes("src/mfa/totp/complete-login-challenge.ts", ISSUE_SESSION_CALL)).not.toEqual([]);
  });
});
