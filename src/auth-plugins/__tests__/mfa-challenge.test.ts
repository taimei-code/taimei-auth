import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { auth } from "../../auth";
import { AuthApi } from "../../auth-service";
import { DbError } from "../../errors";
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
import { MfaTotpRepo } from "../../mfa/totp/ports";
import { getRuntime } from "../../runtime";
import { getMemoryKvStore, ttlStorage } from "../../ttl-store";
import { TtlStore } from "../../ttl-store-service";
import { SentryService } from "../../sentry";
import { partial, runTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { enforceChallenge, KILL_SWITCH_REPORT_INTERVAL_MS, mfaChallenge } from "../mfa-challenge";
import type { PrimaryAuthRoute } from "../primary-auth-routes";

// チャレンジ強制プラグイン (src/auth-plugins/mfa-challenge.ts) の統合テスト。
// magic link は実 HTTP 経路で駆動する。OAuth (/callback/:id) は GitHub の資格情報が無いと
// provider 自体が登録されないため、hook を実 auth context 付きの transport ctx で直接叩く
// (状態の書き込みは本物。実 OAuth 連携の確認は手動台帳 QA-MR-02)。

const P = "mfa-plugin-";
const run = runTest(P);
const sentry = installSentryRecorder();
const killSwitchWarnings = () =>
  sentry.messages.filter((capture) => capture.context?.tags?.component === "mfa-challenge");
const withKillSwitchOff = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = process.env.MFA_CHALLENGE_ENABLED;
      process.env.MFA_CHALLENGE_ENABLED = "false";
      return original;
    }),
    () => body,
    (original) =>
      Effect.sync(() => {
        if (original === undefined) delete process.env.MFA_CHALLENGE_ENABLED;
        else process.env.MFA_CHALLENGE_ENABLED = original;
      }),
  );

const CHALLENGE_PAGE_PATH = "/auth/mfa";
const CONSUMER_CALLBACK = "https://app.example.com/dashboard";
// baseURL 未設定時は request origin が採用されるため、テストが叩く origin と揃える。
const AUTH_ORIGIN = "http://localhost:3100";

// テストが発行させたチャレンジの TTL store state を明示的に消す (TTL 待ちにしない)。
const issuedIds: string[] = [];
const trackChallengeFrom = (headers: Headers) =>
  peekLoginChallenge(headers).pipe(
    Effect.flatMap((opened) =>
      Effect.sync(() => {
        if (opened) issuedIds.push(opened.challengeId);
      }),
    ),
  );
const cleanupTrackedChallenges = Effect.sync(() => {
  const store = getMemoryKvStore();
  for (const key of issuedIds.flatMap((id) => [challengeKey(id), attemptsKey(id)]))
    store.delete(key);
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
// そのまま持たせるので、セッション破棄もチャレンジ発行も実 TTL store / 実 DB に効く。
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

      const afterHook = mfaChallenge(getRuntime()).hooks?.after?.[0];
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

// recorder の restore は file 全体の最後 (後続 describe も同じ recorder を読む)。
afterAll(() => sentry.restore());

describe("チャレンジ強制プラグイン", () => {
  beforeEach(() => cleanupAll().then(() => sentry.reset()));
  afterAll(() => cleanupAll());

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
        // リンク発行・session 書き込みも ttlStorage.set を通るため、注入はチャレンジ key に限る。
        const link = yield* requestMagicLink({ email: user.email, callbackURL: CONSUMER_CALLBACK });
        const originalSet = ttlStorage.set.bind(ttlStorage);

        const login = yield* Effect.acquireUseRelease(
          Effect.sync(() =>
            spyOn(ttlStorage, "set").mockImplementation((key, value, ttl) => {
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

// program 単体 (設計 D9 / D12): fake Layer を内側で provide し、判定・介入・kill switch の各分岐を DB 非依存で固定する。
// kill switch の最終通知時刻は module-level の Ref で QA-D-11 と共有するため、この describe は QA-D-11 の後に置き、
// 時計は「QA-D-11 が残した値より INTERVAL 以上先」から始める (初回通知を確実に起こす)。
describe("enforceChallenge (program 単体)", () => {
  beforeEach(() => sentry.reset());

  const GITHUB: PrimaryAuthRoute = { _tag: "Mapped", method: "github" };
  const UNMAPPED_GITLAB: PrimaryAuthRoute = {
    _tag: "Unmapped",
    path: "/callback/:id",
    providerId: "gitlab",
  };
  const inputWith = (calls: string[], route: PrimaryAuthRoute = GITHUB) => ({
    userId: "user-unit",
    sessionToken: "token-unit",
    route,
    location: CONSUMER_CALLBACK,
    setCookie: () => {
      calls.push("setCookie");
    },
    dropIssuedSession: () => {
      calls.push("drop");
    },
  });
  const enrollment = (row: { verifiedAt: Date | null } | undefined) =>
    Layer.succeed(
      MfaTotpRepo,
      partial<MfaTotpRepo["Service"]>({ readMfaVerification: () => Effect.succeed(row) }),
    );
  const mfaEnabled = enrollment({ verifiedAt: new Date() });
  // method を渡さない partial は呼ばれた時点で die する = 「0 回」の決定的信号。
  const untouched = Layer.mergeAll(
    Layer.succeed(TtlStore, partial<TtlStore["Service"]>({})),
    Layer.succeed(AuthApi, partial<AuthApi["Service"]>({})),
  );
  const interventionSucceeds = (calls: string[]) =>
    Layer.mergeAll(
      Layer.succeed(TtlStore, partial<TtlStore["Service"]>({ set: () => Effect.void })),
      Layer.succeed(
        AuthApi,
        partial<AuthApi["Service"]>({
          secret: Effect.succeed("test-secret"),
          deleteSession: (token) =>
            Effect.sync(() => {
              calls.push(`deleteSession:${token}`);
            }),
        }),
      ),
    );
  const decide = <R>(input: ReturnType<typeof inputWith>, layer: Layer.Layer<R>) =>
    Effect.exit(enforceChallenge(input).pipe(Effect.provide(layer)));
  const dyingSentry = (method: "captureException" | "captureMessage") =>
    Layer.succeed(
      SentryService,
      partial<SentryService["Service"]>({ [method]: () => Effect.die(new Error("sentry down")) }),
    );

  test("AC-154 成功順序: setCookie → drop → deleteSession(token) が各 1 回で challenge", () =>
    run(
      Effect.gen(function* () {
        const calls: string[] = [];
        const exit = yield* decide(
          inputWith(calls),
          Layer.mergeAll(mfaEnabled, interventionSucceeds(calls)),
        );
        expect(exit).toEqual(Exit.succeed("challenge"));
        expect(calls).toEqual(["setCookie", "drop", "deleteSession:token-unit"]);
      }),
    ));

  test("AC-155 MFA 未有効は pass、介入の副作用は 0 回", () =>
    run(
      Effect.gen(function* () {
        const calls: string[] = [];
        const exit = yield* decide(
          inputWith(calls),
          Layer.mergeAll(enrollment({ verifiedAt: null }), untouched),
        );
        expect(exit).toEqual(Exit.succeed("pass"));
        expect(calls).toEqual([]);
        expect(sentry.exceptions.length).toBe(0);
      }),
    ));

  test("AC-158 未知 provider は fail-closed: challenge、drop 1 回、cookie / TTL store 0 回、Sentry warning 1 件", () =>
    run(
      Effect.gen(function* () {
        const calls: string[] = [];
        const exit = yield* decide(
          inputWith(calls, UNMAPPED_GITLAB),
          Layer.mergeAll(mfaEnabled, untouched),
        );
        expect(exit).toEqual(Exit.succeed("challenge"));
        expect(calls).toEqual(["drop"]);
        expect(sentry.exceptions.length).toBe(1);
        expect(sentry.exceptions[0]?.context?.tags).toEqual({ component: "mfa-challenge" });
        expect(sentry.exceptions[0]?.context?.level).toBe("warning");
        expect(sentry.exceptions[0]?.message).toContain(
          "unmapped primary auth route /callback/:id (id=gitlab)",
        );
      }),
    ));

  test("Unmapped でも MFA 未有効なら pass、介入の副作用は 0 回", () =>
    run(
      Effect.gen(function* () {
        const calls: string[] = [];
        const exit = yield* decide(
          inputWith(calls, UNMAPPED_GITLAB),
          Layer.mergeAll(enrollment({ verifiedAt: null }), untouched),
        );
        expect(exit).toEqual(Exit.succeed("pass"));
        expect(calls).toEqual([]);
        expect(sentry.exceptions.length).toBe(0);
      }),
    ));

  test("AC-178 判定の +1 SELECT が失敗しても fail-closed (介入はそのまま進む)", () =>
    run(
      Effect.gen(function* () {
        const calls: string[] = [];
        const failingRepo = Layer.succeed(
          MfaTotpRepo,
          partial<MfaTotpRepo["Service"]>({
            readMfaVerification: () =>
              Effect.fail(new DbError({ cause: new Error("mfa_totp unavailable") })),
          }),
        );
        const exit = yield* decide(
          inputWith(calls),
          Layer.mergeAll(failingRepo, interventionSucceeds(calls)),
        );
        expect(exit).toEqual(Exit.succeed("challenge"));
        expect(calls).toEqual(["setCookie", "drop", "deleteSession:token-unit"]);
        expect(sentry.exceptions.length).toBe(1);
        expect(sentry.exceptions[0]?.context?.tags).toEqual({ component: "mfa-challenge" });
      }),
    ));

  test("AC-161 Sentry backend の defect でも介入経路は challenge で完走する", () =>
    run(
      Effect.gen(function* () {
        const calls: string[] = [];
        const exit = yield* decide(
          inputWith(calls, UNMAPPED_GITLAB),
          Layer.mergeAll(mfaEnabled, untouched, dyingSentry("captureException")),
        );
        expect(exit).toEqual(Exit.succeed("challenge"));
        expect(calls).toEqual(["drop"]);
      }),
    ));

  // kill switch off の 2 case。時計の起点は QA-D-11 が残した「実時刻 + INTERVAL + 1」より INTERVAL 以上先。
  const withClockAt = <A, E, R>(at: number, body: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => spyOn(Date, "now").mockReturnValue(at)),
      () => body,
      (clock) => Effect.sync(() => clock.mockRestore()),
    );

  test("AC-162 Sentry backend の defect でも kill switch off は pass (kill switch が無効化されない)", () =>
    run(
      withKillSwitchOff(
        Effect.gen(function* () {
          const calls: string[] = [];
          const t0 = Date.now() + 3 * KILL_SWITCH_REPORT_INTERVAL_MS;
          const exit = yield* withClockAt(
            t0,
            decide(
              inputWith(calls),
              Layer.mergeAll(mfaEnabled, untouched, dyingSentry("captureMessage")),
            ),
          );
          expect(exit).toEqual(Exit.succeed("pass"));
          expect(calls).toEqual([]);
        }),
      ),
    ));

  test("AC-166 再通知の境界: INTERVAL - 1 では鳴らず、ちょうど INTERVAL で鳴る", () =>
    run(
      withKillSwitchOff(
        Effect.gen(function* () {
          const layer = Layer.mergeAll(mfaEnabled, untouched);
          // AC-162 が残した値より INTERVAL 以上先に置き、ここで最終通知時刻を t0 に確定させる。
          const t0 = Date.now() + 6 * KILL_SWITCH_REPORT_INTERVAL_MS;
          const at = (offset: number) =>
            withClockAt(t0 + offset, decide(inputWith([]), layer)).pipe(
              Effect.map(() => killSwitchWarnings().length),
            );

          expect(yield* at(0)).toBe(1);
          expect(yield* at(KILL_SWITCH_REPORT_INTERVAL_MS - 1)).toBe(1);
          expect(yield* at(KILL_SWITCH_REPORT_INTERVAL_MS)).toBe(2);
        }),
      ),
    ));
});
