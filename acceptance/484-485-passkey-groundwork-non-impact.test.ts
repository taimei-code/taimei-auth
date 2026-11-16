import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readRepoText } from "./harness/repo-text";
import { stoppingLintCodes } from "./harness/lint-probe";
import {
  cleanupMfaChallengeFixtures,
  passMfaChallenge,
  passMfaChallengeWhileSessionStoreIsDown,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
} from "./harness/mfa-challenge-pass";

const MFA_ENTRY = "**多要素認証 (MFA)**:\n知識、所持、生体のうち 2 つ以上の要素で本人であることを確認する仕組み。taimei-auth では認証アプリ (**TOTP**) を第二要素として提供し、一次認証 (**Magic Link** / GitHub OAuth) の成功後に **MFA チャレンジ** を要求する。user 単位の任意設定であり、**事業所** による強制は持たない。有効化と無効化のどちらも本人へ通知メールを送る。詳細: ADR-0016。\n_Avoid_: 2FA / 二要素認証 (要素数を 2 に固定する語。第二要素が増えた時に成り立たなくなる), twoFactor (撤去した外部ライブラリの機能名)";
const MFA_CHALLENGE_ENTRY = "**MFA チャレンジ**:\n一次認証は成功したが第二要素はまだ確かめていない、という中間状態そのもの。有効期間は 10 分で、署名付きの cookie で 1 つのチャレンジを識別し、状態は **TTL store** に置く。発行した時点で一次認証が作った **session** は破棄するため、チャレンジが保留中の user は consumer app からは未認証に見える。通過手段は **TOTP** のコードか **リカバリーコード**。詳細: ADR-0016。\n_Avoid_: 2FA チャレンジ, 二段階認証画面 (画面は状態の表現の一つに過ぎない), pending session (session は存在しないため誤り)";
const PRIMARY_AUTH_RELATIONSHIP = "- **多要素認証 (MFA)** を有効にした user では、一次認証 (**Magic Link** / GitHub OAuth) の成功は **session** ではなく **MFA チャレンジ** を作る。**session** はチャレンジの通過時に初めて確立される";

const ISSUE_SESSION_CALL = "export const r = (api: { issueSession(): void }) => api.issueSession();";

describe("一次認証と MFA チャレンジの用語", () => {
  test("GLOSSARY.md の多要素認証 (MFA)、MFA チャレンジ、一次認証が MFA チャレンジを作る関係の文は今のまま", () => {
    const glossary = readRepoText("GLOSSARY.md");
    expect(glossary).toContain(MFA_ENTRY);
    expect(glossary).toContain(MFA_CHALLENGE_ENTRY);
    expect(glossary).toContain(PRIMARY_AUTH_RELATIONSHIP);
  });
});

describe("MFA チャレンジの通過", () => {
  beforeEach(cleanupMfaChallengeFixtures);
  afterAll(cleanupMfaChallengeFixtures);

  test("正しい TOTP で通過すると、遷移先を返し、チャレンジの cookie を消して、その user の session cookie を 1 本渡す", async () => {
    const passed = await passMfaChallenge({ redirectUrl: "/account/security", method: "magic_link" });
    expect(passed.status).toBe(200);
    expect(passed.body).toEqual({ redirect_url: "/account/security" });
    expect(passed.setCookies.map((cookie) => cookie.split("=")[0]).sort()).toEqual([
      "__Host-mfa_login_challenge",
      "__Secure-better-auth.session_token",
    ]);
    expect(
      passed.setCookies.filter((cookie) => cookie.startsWith("__Host-mfa_login_challenge=")).every((cookie) => /max-age=0(;|$)/i.test(cookie)),
    ).toBe(true);
    expect(passed.sessionUserId).toBe(passed.userId);
  });

  test.each(["magic_link", "github"] as const)("通過すると、一次認証の方法 %s と IP と userAgent でログインを 1 件だけ記録する", async (method) => {
    const passed = await passMfaChallenge({ redirectUrl: "/account/security", method });
    expect(passed.signInPayloads).toEqual([{ method, ip: TEST_CLIENT_IP, userAgent: TEST_USER_AGENT }]);
  });

  test("session を発行できなかった通過の試みは成功を返さず、ログインを記録しない", async () => {
    const attempted = await passMfaChallengeWhileSessionStoreIsDown();
    expect(attempted.status).not.toBe(200);
    expect(attempted.sessionUserId).toBeNull();
    expect(attempted.signInPayloads).toEqual([]);
  });

  test("信頼できない遷移先を置いたチャレンジを通過すると、遷移先は /account になる", async () => {
    const passed = await passMfaChallenge({ redirectUrl: "https://evil.example.net/phish", method: "magic_link" });
    expect(passed.body).toEqual({ redirect_url: "/account" });
  });
});

describe("session を発行してよい場所", () => {
  test.each(["src/mfa/zz-probe.ts", "src/mfa/totp/zz-probe.ts", "src/handlers/zz-probe.ts", "src/passkey/zz-probe.ts", "src/zz-probe.ts"])(
    "%s で AuthApi.issueSession を呼ぶと lint が止める",
    (path) => {
      expect(stoppingLintCodes(path, ISSUE_SESSION_CALL)).not.toEqual([]);
    },
  );
});
