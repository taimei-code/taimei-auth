import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { auth } from "../../auth";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import {
  browserCookieHeaders,
  cleanupIssuedChallenges,
  countLiveSessions,
  enableMfaFor,
  followMagicLink,
  installSentryRecorder,
  issuedSessionCookieCount,
  loginWithMagicLink,
  requestMagicLink,
} from "../../mfa/__tests__/helpers";
import {
  attemptsKey,
  challengeKey,
  peekLoginChallenge,
  readLoginChallengeState,
} from "../../mfa/totp/login-challenge";
import { getRedis, redisStorage } from "../../redis";
import { KILL_SWITCH_REPORT_INTERVAL_MS, mfaChallenge } from "../mfa-challenge";

// チャレンジ強制プラグイン (src/auth-plugins/mfa-challenge.ts) の統合テスト。
// magic link は実 HTTP 経路で駆動する。OAuth (/callback/:id) は GitHub の資格情報が無いと
// provider 自体が登録されないため、hook を実 auth context 付きの transport ctx で直接叩く
// (状態の書き込みは本物。実 OAuth 連携の確認は手動台帳 QA-MR-02)。

const P = "mfa-plugin-";
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

const CHALLENGE_PAGE_PATH = "/auth/mfa";
const CONSUMER_CALLBACK = "https://app.example.com/dashboard";
// baseURL 未設定時は request origin が採用されるため、テストが叩く origin と揃える。
const AUTH_ORIGIN = "http://localhost:3100";

// テストが発行させたチャレンジの Redis state を明示的に消す (TTL 待ちにしない)。
const issuedIds: string[] = [];
const trackChallengeFrom = async (headers: Headers): Promise<void> => {
  const opened = await peekLoginChallenge(headers);
  if (opened) issuedIds.push(opened.challengeId);
};
const cleanupTrackedChallenges = async (): Promise<void> => {
  const redis = await getRedis();
  await Promise.all(
    issuedIds.flatMap((id) => [redis.del(challengeKey(id)), redis.del(attemptsKey(id))]),
  );
  issuedIds.length = 0;
};

const cleanupAll = async (): Promise<void> => {
  await cleanupTrackedChallenges();
  await cleanupIssuedChallenges();
  await cleanup();
};

type OAuthCallbackOutcome = {
  redirectStatus: number | undefined;
  redirectedTo: string | null;
  newSessionUpdates: unknown[];
  responseHeaders: Headers;
};

// after-hook が使う機能だけを載せた transport ctx。context は実物 (internalAdapter / baseURL) を
// そのまま持たせるので、セッション破棄もチャレンジ発行も実 Redis / 実 DB に効く。
async function runOAuthCallbackHook(
  newSession: { session: { token: string }; user: Record<string, unknown> } | null,
): Promise<OAuthCallbackOutcome> {
  const authContext = await auth.$context;
  const responseHeaders = new Headers();
  responseHeaders.set("location", CONSUMER_CALLBACK);
  const newSessionUpdates: unknown[] = [];

  const ctx = {
    path: "/callback/:id",
    params: { id: "github" },
    responseHeaders,
    context: Object.assign(Object.create(Object.getPrototypeOf(authContext)), authContext, {
      newSession,
      setNewSession: (value: unknown) => newSessionUpdates.push(value),
      responseHeaders,
      baseURL: AUTH_ORIGIN,
    }),
    setCookie: (name: string, value: string) => {
      responseHeaders.append("set-cookie", `${name}=${encodeURIComponent(value)}`);
    },
  };

  const afterHook = mfaChallenge().hooks?.after?.[0];
  if (!afterHook) throw new Error("mfa-challenge plugin has no after hook");
  expect(afterHook.matcher(ctx as never)).toBe(true);

  const thrown = await Promise.resolve(afterHook.handler(ctx as never)).then(
    () => undefined,
    (error: unknown) => error as { statusCode?: number; headers?: Headers },
  );
  const outcome = {
    redirectStatus: thrown?.statusCode,
    redirectedTo: thrown?.headers?.get("location") ?? null,
    newSessionUpdates,
    responseHeaders,
  };
  await trackChallengeFrom(browserCookieHeaders(new Response(null, { headers: responseHeaders })));
  return outcome;
}

describe("チャレンジ強制プラグイン", () => {
  beforeEach(async () => {
    await cleanupAll();
    sentry.reset();
  });

  afterAll(async () => {
    await cleanupAll();
    sentry.restore();
  });

  test("QA-H-03 magic link → 302 /auth/mfa", async () => {
    const user = await seedUser("h03");
    await enableMfaFor(user);

    const login = await loginWithMagicLink({ email: user.email, callbackURL: CONSUMER_CALLBACK });
    const browserHeaders = browserCookieHeaders(login.response);
    await trackChallengeFrom(browserHeaders);

    expect(login.response.status).toBe(302);
    expect(login.location?.pathname).toBe(CHALLENGE_PAGE_PATH);
    // 一次認証だけでセッションが立つと MFA が飾りになる。cookie が 1 本も出ていないことが核。
    expect(await issuedSessionCookieCount(login.response.headers)).toBe(0);
    // チャレンジ cookie の実在は「名前があるか」でなく「そのまま読み戻せるか」で見る。
    expect(await readLoginChallengeState(browserHeaders)).toEqual({ pending: true });
    expect(await peekLoginChallenge(browserHeaders)).toMatchObject({
      userId: user.id,
      redirectUrl: CONSUMER_CALLBACK,
      method: "magic_link",
    });
  });

  test("QA-H-08 MFA 未設定 → callbackURL へ 302", async () => {
    const user = await seedUser("h08");

    const login = await loginWithMagicLink({ email: user.email, callbackURL: CONSUMER_CALLBACK });

    expect(login.response.status).toBe(302);
    expect(login.location?.toString()).toBe(CONSUMER_CALLBACK);
    expect(await issuedSessionCookieCount(login.response.headers)).toBe(1);
    expect(await readLoginChallengeState(browserCookieHeaders(login.response))).toEqual({
      pending: false,
    });
  });

  test("QA-E-12 チャレンジ発行失敗 fail-closed", async () => {
    const user = await seedUser("e12");
    await enableMfaFor(user);
    // リンク発行・session 書き込みも redisStorage.set を通るため、注入はチャレンジ key に限る。
    const link = await requestMagicLink({ email: user.email, callbackURL: CONSUMER_CALLBACK });
    const originalSet = redisStorage.set.bind(redisStorage);
    const failing = spyOn(redisStorage, "set").mockImplementation((key, value, ttl) => {
      if (key.startsWith("mfa:login-challenge:")) {
        return Promise.reject(new Error("challenge store unavailable"));
      }
      return originalSet(key, value, ttl);
    });

    try {
      const login = await followMagicLink(link);

      // 元の 302 を通す fail-open だと、MFA を有効にした user が第二要素なしでセッションを得る。
      expect(login.location?.pathname).toBe(CHALLENGE_PAGE_PATH);
      expect(login.location?.toString()).not.toBe(CONSUMER_CALLBACK);
      expect(await issuedSessionCookieCount(login.response.headers)).toBe(0);
      expect(sentry.exceptions.length).toBe(1);
      expect(sentry.exceptions[0]?.context?.tags).toEqual({ component: "mfa-challenge" });
    } finally {
      failing.mockRestore();
    }
  });

  test("QA-E-13 deleteSession 失敗 fail-closed", async () => {
    const user = await seedUser("e13");
    await enableMfaFor(user);
    const authContext = await auth.$context;
    const failing = spyOn(authContext.internalAdapter, "deleteSession").mockRejectedValue(
      new Error("session store unavailable"),
    );

    try {
      const login = await loginWithMagicLink({ email: user.email, callbackURL: CONSUMER_CALLBACK });
      await trackChallengeFrom(browserCookieHeaders(login.response));

      expect(login.location?.pathname).toBe(CHALLENGE_PAGE_PATH);
      // 破棄が失敗しても cookie が出ていなければブラウザは使えるセッションを持たない。
      expect(await issuedSessionCookieCount(login.response.headers)).toBe(0);
      expect(sentry.exceptions.length).toBe(1);
      expect(sentry.exceptions[0]?.context?.tags).toEqual({ component: "mfa-challenge" });
    } finally {
      failing.mockRestore();
    }
  });

  test("QA-D-11 kill switch off → warning は再通知間隔ごとに 1 回", async () => {
    const user = await seedUser("d11");
    const enabled = await enableMfaFor(user);
    const original = process.env.MFA_CHALLENGE_ENABLED;
    process.env.MFA_CHALLENGE_ENABLED = "false";
    const killSwitchWarnings = () =>
      sentry.messages.filter((capture) => capture.context?.tags?.component === "mfa-challenge");

    try {
      const first = await loginWithMagicLink({ email: user.email, callbackURL: CONSUMER_CALLBACK });
      const second = await loginWithMagicLink({
        email: user.email,
        callbackURL: CONSUMER_CALLBACK,
      });

      for (const login of [first, second]) {
        expect(login.location?.toString()).toBe(CONSUMER_CALLBACK);
        expect(await issuedSessionCookieCount(login.response.headers)).toBe(1);
      }
      // 停止中である事実は届けたいが、全ログインで警告を出すとノイズで埋もれる。
      expect(killSwitchWarnings().length).toBe(1);
      expect(killSwitchWarnings()[0]?.message).toBe(
        "mfa: challenge enforcement disabled by kill switch",
      );
      expect(killSwitchWarnings()[0]?.context?.level).toBe("warning");

      // 間隔を跨いだら鳴り直す。1 回きりだと常駐 isolate が初回以降ずっと黙る。時計を進めて
      // 安全なのは kill switch 判定が介入より前で return するため。
      const afterInterval = Date.now() + KILL_SWITCH_REPORT_INTERVAL_MS + 1;
      const clock = spyOn(Date, "now").mockReturnValue(afterInterval);
      try {
        await runOAuthCallbackHook({
          session: { token: enabled.session.token },
          user: { id: user.id },
        });
      } finally {
        clock.mockRestore();
      }

      expect(killSwitchWarnings().length).toBe(2);
    } finally {
      if (original === undefined) delete process.env.MFA_CHALLENGE_ENABLED;
      else process.env.MFA_CHALLENGE_ENABLED = original;
    }
  });

  test("QA-R-02 連携がチャレンジ誘発しない (実 OAuth は QA-MR-02)", async () => {
    const user = await seedUser("r02");
    const enabled = await enableMfaFor(user);

    // accountLinking は既存セッションのまま /callback/:id を通り、新しいセッションを積まない。
    const linking = await runOAuthCallbackHook(null);

    expect(linking.redirectedTo).toBeNull();
    expect(linking.newSessionUpdates).toEqual([]);
    expect(await countLiveSessions([enabled.session.token])).toBe(1);

    // 同じ route でも一次認証としてセッションが立った時は介入する (matcher が死んでいない証拠)。
    // チャレンジ要否は自前 mfa_totp 行から導出されるため user object に flag は不要。
    const signingIn = await runOAuthCallbackHook({
      session: { token: enabled.session.token },
      user: { id: user.id },
    });

    expect(signingIn.redirectStatus).toBe(302);
    expect(new URL(signingIn.redirectedTo as string).pathname).toBe(CHALLENGE_PAGE_PATH);
    expect(signingIn.newSessionUpdates).toEqual([null]);
    expect(await countLiveSessions([enabled.session.token])).toBe(0);
  });
});
