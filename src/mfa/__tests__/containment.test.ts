import { describe, expect, test } from "bun:test";
import { grepFiles, sourceFiles, valueImportsOf } from "../../__tests__/source-scan";

const SEARCH_ROOTS = "src web/src";

const filesWithCodeLiteral = (pattern: string, roots: string = SEARCH_ROOTS): string[] =>
  roots
    .split(" ")
    .flatMap((root) => grepFiles(pattern, root, { tests: "exclude" }))
    .sort();

const importOccurrences = (root: string, specifier: RegExp): string[] =>
  sourceFiles(root, { tests: "exclude" })
    .flatMap((file) =>
      valueImportsOf(file)
        .filter((imported) => specifier.test(imported))
        .map((imported) => `${file}:${imported}`),
    )
    .sort();

describe("ログイン hot path の非影響 (静的 tripwire)", () => {
  test("auth-plugins が import してよい mfa モジュールは 4 つに限る", () => {
    expect(filesWithCodeLiteral("from ", "src/auth-plugins").length).toBeGreaterThan(0);
    expect(importOccurrences("src/auth-plugins", /mfa\//)).toEqual([
      "src/auth-plugins/mfa-challenge.ts:../mfa/redirect-guard",
      "src/auth-plugins/mfa-challenge.ts:../mfa/totp/challenge-required",
      "src/auth-plugins/mfa-challenge.ts:../mfa/totp/login-challenge",
      "src/auth-plugins/primary-auth.ts:../mfa/kill-switch",
    ]);
    expect(filesWithCodeLiteral("db/repositories/mfa-totp", "src/auth-plugins")).toEqual([]);
  });

  test("kill switch の env を読むのは一次認証の after-hook だけ (program は引数で受ける)", () => {
    expect(filesWithCodeLiteral("MFA_CHALLENGE_ENABLED")).toEqual([
      "src/auth-plugins/primary-auth.ts",
    ]);
  });
});

describe("MFA totp module boundary", () => {
  test("AuthApi.issueSession の session cookie は hono の serialize で組み、属性を手で書かない (session cookie の契約)", () => {
    expect(filesWithCodeLiteral("hono/utils/cookie", "src/mfa src/auth-wiring.ts")).toEqual([
      "src/auth-wiring.ts",
      "src/mfa/totp/login-challenge.ts",
    ]);
    expect(
      filesWithCodeLiteral("Max-Age=|HttpOnly|SameSite=", "src/mfa src/auth-wiring.ts"),
    ).toEqual([]);
  });

  test("db/repositories/mfa-totp を import する production code は決まった file だけ", () => {
    expect(filesWithCodeLiteral("db/repositories/mfa-totp", "src management")).toEqual([
      "src/id-generator.ts",
      "src/mfa/totp/enroll-mfa.ts",
      "src/mfa/totp/ports.ts",
      "src/mfa/totp/wiring.ts",
    ]);
  });

  test("チャレンジの cookie 名の文字列は login-challenge.ts だけが持つ", () => {
    expect(filesWithCodeLiteral("mfa_login_challenge")).toEqual([
      "src/mfa/totp/login-challenge.ts",
    ]);
  });

  test("secret を返す findMfaTotp を使う code は決まった file だけ", () => {
    expect(filesWithCodeLiteral("findMfaTotp", "src db management")).toEqual([
      "db/repositories/mfa-totp.ts",
      "src/mfa/totp/activate-mfa.ts",
      "src/mfa/totp/enroll-mfa.ts",
      "src/mfa/totp/verify-code.ts",
    ]);
  });

  test("verifiedAt を読む production code は policy.ts だけ (db/ は列を持つ層なので対象外)", () => {
    expect(filesWithCodeLiteral("verifiedAt", "src web/src management")).toEqual([
      "src/mfa/policy.ts",
    ]);
  });

  test("façade が実行時に export する関数 (handler が使ってよいもの) は決まっている", async () => {
    const facade = await import("../totp");
    expect(Object.keys(facade).sort()).toEqual([
      "activate",
      "completeLoginChallenge",
      "disable",
      "enroll",
      "readLoginChallengeState",
      "readOwnedMfaStatus",
    ]);
  });

  test("management/ の import 面は全列挙で固定する", () => {
    expect(importOccurrences("management", /^((\.\.\/)+(src|db)\/|@\/|@core\/)/)).toEqual([
      "management/disable-user-mfa.ts:../src/boot",
      "management/disable-user-mfa.ts:../src/mfa/totp/disable-mfa",
      "management/sweep-abandoned-signups.ts:../src/account/sweep-abandoned-signups",
      "management/sweep-abandoned-signups.ts:../src/boot",
    ]);
  });

  test("db/ は src/ を import しない (identity DB を分離する時に逆向きの依存を作らない)", () => {
    expect(filesWithCodeLiteral(`from ['"](\\.\\./)*\\.\\./src/`, "db")).toEqual([]);
  });
});
