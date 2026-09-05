import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { auth } from "../../auth";
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
import { runTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { KILL_SWITCH_REPORT_INTERVAL_MS, mfaChallenge } from "../mfa-challenge";

// チャレンジ強制プラグイン (src/auth-plugins/mfa-challenge.ts) の統合テスト。
// magic link は実 HTTP 経路で駆動する。OAuth (/callback/:id) は GitHub の資格情報が無いと
// provider 自体が登録されないため、hook を実 auth context 付きの transport ctx で直接叩く
// (状態の書き込みは本物。実 OAuth 連携の確認は手動台帳 QA-MR-02)。

const P = "mfa-plugin-";
const run = runTest(P);
const sentry = installSentryRecorder();

const CHALLENGE_PAGE_PATH = "/auth/mfa";
const CONSUMER_CALLBACK = "https://app.example.com/dashboard";
// baseURL 未設定時は request origin が採用されるため、テストが叩く origin と揃える。
const AUTH_ORIGIN = "http://localhost:3100";

// テストが発行させたチャレンジの Redis state を明示的に消す (TTL 待ちにしない)。
const issuedIds: string[] = [];
const trackChallengeFrom = (headers: Headers) =>
  peekLoginChallenge(headers).pipe(
    Effect.flatMap((opened) =>
      Effect.sync(() => {
        if (opened) issuedIds.push(opened.challengeId);
      }),
    ),
  );
const cleanupTrackedChallenges = Effect.gen(function* () {
  const redis = yield* Effect.promise(() => getRedis());
  yield* Effect.forEach(
    issuedIds.flatMap((id) => [challengeKey(id), attemptsKey(id)]),
    (key) => Effect.promise(() => redis.del(key)),
    { concurrency: "unbounded" },
  );
  issuedIds.length = 0;
});

const cleanupAll = () =>
  run(
    Effect.gen(function* () {
      yield* cleanupTrackedChallenges;
      yield* cleanupIssuedChallenges();
      yield* (yield* TestDb).cleanup();
    }),
  );

type OAuthCallbackOutcome = {
  redirectStatus: number | undefined;
  redirectedTo: string | null;
  newSessionUpdates: unknown[];
  responseHeaders: Headers;
};

// after-hook が使う機能だけを載せた transport ctx。context は実物 (internalAdapter / baseURL) を
// そのまま持たせるので、セッション破棄もチャレンジ発行も実 Redis / 実 DB に効く。
const runOAuthCallbackHook = (
  newSession: { session: { token: string }; user: Record<string, unknown> } | null,
) =>
  Effect.gen(function* () {
    const outcome = yield* Effect.promise(async (): Promise<OAuthCallbackOutcome> => {
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
      return {
        redirectStatus: thrown?.statusCode,
        redirectedTo: thrown?.headers?.get("location") ?? null,
        newSessionUpdates,
        responseHeaders,
      };
    });
    yield* trackChallengeFrom(
      browserCookieHeaders(new Response(null, { headers: outcome.responseHeaders })),
    );
    return outcome;
  });

describe("チャレンジ強制プラグイン", () => {
  beforeEach(() => cleanupAll().then(() => sentry.reset()));
  afterAll(() => cleanupAll().then(() => sentry.restore()));

  test("QA-H-03 magic link → 302 /auth/mfa", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("h03");
        yield* enableMfaFor(user);

        const login = yield* loginWithMagicLink({
          email: user.email,
          callbackURL: CONSUMER_CALLBACK,
        });
        const browserHeaders = browserCookieHeaders(login.response);
        yield* trackChallengeFrom(browserHeaders);

        expect(login.response.status).toBe(302);
        expect(login.location?.pathname).toBe(CHALLENGE_PAGE_PATH);
        // 一次認証だけでセッションが立つと MFA が飾りになる。cookie が 1 本も出ていないことが核。
        expect(yield* issuedSessionCookieCount(login.response.headers)).toBe(0);
        // チャレンジ cookie の実在は「名前があるか」でなく「そのまま読み戻せるか」で見る。
        expect(yield* readLoginChallengeState(browserHeaders)).toEqual({ pending: true });
        expect(yield* peekLoginChallenge(browserHeaders)).toMatchObject({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
      }),
    ));

  test("QA-H-08 MFA 未設定 → callbackURL へ 302", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("h08");

        const login = yield* loginWithMagicLink({
          email: user.email,
          callbackURL: CONSUMER_CALLBACK,
        });

        expect(login.response.status).toBe(302);
        expect(login.location?.toString()).toBe(CONSUMER_CALLBACK);
        expect(yield* issuedSessionCookieCount(login.response.headers)).toBe(1);
        expect(yield* readLoginChallengeState(browserCookieHeaders(login.response))).toEqual({
          pending: false,
        });
      }),
    ));

  test("QA-E-12 チャレンジ発行失敗 fail-closed", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("e12");
        yield* enableMfaFor(user);
        // リンク発行・session 書き込みも redisStorage.set を通るため、注入はチャレンジ key に限る。
        const link = yield* requestMagicLink({ email: user.email, callbackURL: CONSUMER_CALLBACK });
        const originalSet = redisStorage.set.bind(redisStorage);

        const login = yield* Effect.acquireUseRelease(
          Effect.sync(() =>
            spyOn(redisStorage, "set").mockImplementation((key, value, ttl) => {
              if (key.startsWith("mfa:login-challenge:")) {
                return Promise.reject(new Error("challenge store unavailable"));
              }
              return originalSet(key, value, ttl);
            }),
          ),
          () => followMagicLink(link),
          (failing) => Effect.sync(() => failing.mockRestore()),
        );

        // 元の 302 を通す fail-open だと、MFA を有効にした user が第二要素なしでセッションを得る。
        expect(login.location?.pathname).toBe(CHALLENGE_PAGE_PATH);
        expect(login.location?.toString()).not.toBe(CONSUMER_CALLBACK);
        expect(yield* issuedSessionCookieCount(login.response.headers)).toBe(0);
        expect(sentry.exceptions.length).toBe(1);
        expect(sentry.exceptions[0]?.context?.tags).toEqual({ component: "mfa-challenge" });
      }),
    ));

  test("QA-E-13 deleteSession 失敗 fail-closed", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("e13");
        yield* enableMfaFor(user);
        const authContext = yield* Effect.promise(() => auth.$context);

        const login = yield* Effect.acquireUseRelease(
          Effect.sync(() =>
            spyOn(authContext.internalAdapter, "deleteSession").mockRejectedValue(
              new Error("session store unavailable"),
            ),
          ),
          () =>
            Effect.gen(function* () {
              const login = yield* loginWithMagicLink({
                email: user.email,
                callbackURL: CONSUMER_CALLBACK,
              });
              yield* trackChallengeFrom(browserCookieHeaders(login.response));
              return login;
            }),
          (failing) => Effect.sync(() => failing.mockRestore()),
        );

        expect(login.location?.pathname).toBe(CHALLENGE_PAGE_PATH);
        // 破棄が失敗しても cookie が出ていなければブラウザは使えるセッションを持たない。
        expect(yield* issuedSessionCookieCount(login.response.headers)).toBe(0);
        expect(sentry.exceptions.length).toBe(1);
        expect(sentry.exceptions[0]?.context?.tags).toEqual({ component: "mfa-challenge" });
      }),
    ));

  test("QA-D-11 kill switch off → warning は再通知間隔ごとに 1 回", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("d11");
        const enabled = yield* enableMfaFor(user);
        const killSwitchWarnings = () =>
          sentry.messages.filter((capture) => capture.context?.tags?.component === "mfa-challenge");

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            const original = process.env.MFA_CHALLENGE_ENABLED;
            process.env.MFA_CHALLENGE_ENABLED = "false";
            return original;
          }),
          () =>
            Effect.gen(function* () {
              const first = yield* loginWithMagicLink({
                email: user.email,
                callbackURL: CONSUMER_CALLBACK,
              });
              const second = yield* loginWithMagicLink({
                email: user.email,
                callbackURL: CONSUMER_CALLBACK,
              });

              for (const login of [first, second]) {
                expect(login.location?.toString()).toBe(CONSUMER_CALLBACK);
                expect(yield* issuedSessionCookieCount(login.response.headers)).toBe(1);
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
              yield* Effect.acquireUseRelease(
                Effect.sync(() => spyOn(Date, "now").mockReturnValue(afterInterval)),
                () =>
                  runOAuthCallbackHook({
                    session: { token: enabled.session.token },
                    user: { id: user.id },
                  }),
                (clock) => Effect.sync(() => clock.mockRestore()),
              );

              expect(killSwitchWarnings().length).toBe(2);
            }),
          (original) =>
            Effect.sync(() => {
              if (original === undefined) delete process.env.MFA_CHALLENGE_ENABLED;
              else process.env.MFA_CHALLENGE_ENABLED = original;
            }),
        );
      }),
    ));

  test("QA-R-02 連携がチャレンジ誘発しない (実 OAuth は QA-MR-02)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("r02");
        const enabled = yield* enableMfaFor(user);

        // accountLinking は既存セッションのまま /callback/:id を通り、新しいセッションを積まない。
        const linking = yield* runOAuthCallbackHook(null);

        expect(linking.redirectedTo).toBeNull();
        expect(linking.newSessionUpdates).toEqual([]);
        expect(yield* countLiveSessions([enabled.session.token])).toBe(1);

        // 同じ route でも一次認証としてセッションが立った時は介入する (matcher が死んでいない証拠)。
        // チャレンジ要否は自前 mfa_totp 行から導出されるため user object に flag は不要。
        const signingIn = yield* runOAuthCallbackHook({
          session: { token: enabled.session.token },
          user: { id: user.id },
        });

        expect(signingIn.redirectStatus).toBe(302);
        expect(new URL(signingIn.redirectedTo as string).pathname).toBe(CHALLENGE_PAGE_PATH);
        expect(signingIn.newSessionUpdates).toEqual([null]);
        expect(yield* countLiveSessions([enabled.session.token])).toBe(0);
      }),
    ));
});
