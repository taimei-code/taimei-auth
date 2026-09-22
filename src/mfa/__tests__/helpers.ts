import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { makeSignature } from "better-auth/crypto";
import { Effect } from "effect";
import { auth } from "../../auth";
import { TtlStore } from "../../ttl-store-service";
import { resetDisableAttempts } from "../disable-attempt-budget";
import { activate, enroll } from "../totp";
import type { MfaTotpActor } from "../totp/contracts";
import {
  attemptsKey,
  challengeKey,
  type ChallengeMethod,
  openLoginChallenge,
} from "../totp/login-challenge";
import { observing } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";

// 状態を DB へ直接書くと暗号化 secret とコードの対応が伴わず後続の検証が偽陽性になるため、生成は production と同じ経路を通す。

// .env に無くても bun test が動くための固定ダミー鍵。
process.env.MFA_TOTP_ENCRYPTION_KEYS ??= "v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

export const TEST_CLIENT_IP = "203.0.113.9";
export const TEST_USER_AGENT = "mfa-integration-test";

// totp-engine.ts の PERIOD と揃える。
const TOTP_PERIOD_SECONDS = 30;

const signCookieValue = (value: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const { secret } = await auth.$context;
    return `${value}.${await makeSignature(value, secret)}`;
  });

// 末尾の文字は base64 のパディングビットを含み、変えても復号後のバイト列が同じで署名が通るため先頭を差し替える。
export function tamperCookieSignature(signed: string): string {
  const separator = signed.lastIndexOf(".");
  const signature = signed.slice(separator + 1);
  const flippedHead = signature[0] === "A" ? "B" : "A";
  return `${signed.slice(0, separator)}.${flippedHead}${signature.slice(1)}`;
}

export function requestHeaders(cookies: Record<string, string> = {}): Headers {
  const headers = new Headers({
    "user-agent": TEST_USER_AGENT,
    "x-forwarded-for": TEST_CLIENT_IP,
  });
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

// percent-decode 後の形式。better-call の getSignedCookie の受理条件より狭い (session-cookie-contract.test.ts が固定)。
export const SIGNED_COOKIE_VALUE = /^[^%;]+\.[A-Za-z0-9+/]{43}=$/;

export type TestSession = { token: string; headers: Headers };

const sessionCookieName = (): Effect.Effect<string> =>
  Effect.promise(async () => (await auth.$context).authCookies.sessionToken.name);

const sessionHeaders = (token: string): Effect.Effect<Headers> =>
  Effect.gen(function* () {
    const name = yield* sessionCookieName();
    return requestHeaders({ [name]: yield* signCookieValue(token) });
  });

// secondaryStorage 構成では session の実体が TTL store にしか無く、DB へ行を入れても getSession は解決しない。
export const createSessionFor = (userId: string): Effect.Effect<TestSession> =>
  Effect.gen(function* () {
    const session = yield* Effect.promise(async () =>
      (await auth.$context).internalAdapter.createSession(userId),
    );
    return { token: session.token, headers: yield* sessionHeaders(session.token) };
  });

export const issuedSessionCookieCount = (forwarded: Headers): Effect.Effect<number> =>
  Effect.map(issuedSessionSetCookies(forwarded), (cookies) => cookies.length);

export const issuedSessionSetCookies = (forwarded: Headers): Effect.Effect<string[]> =>
  Effect.map(sessionCookieName(), (name) =>
    forwarded
      .getSetCookie()
      .filter((cookie) => cookie.startsWith(`${name}=`) && !/max-age=0(;|$)/i.test(cookie))
      .filter((cookie) => setCookieValue(cookie).lastIndexOf(".") > 0),
  );

export function setCookieValue(setCookie: string): string {
  const pair = setCookie.split(";")[0];
  return pair.slice(pair.indexOf("=") + 1);
}

export function actorOf(user: { id: string; email: string }): MfaTotpActor {
  return { id: user.id, email: user.email };
}

// secret は ASCII なので base32 から TextDecoder で往復しても変わらない。
export function secretFromTotpUri(totpUri: string): string {
  const encoded = new URL(totpUri).searchParams.get("secret");
  if (!encoded) throw new Error(`totp uri has no secret: ${totpUri}`);
  return new TextDecoder().decode(base32.decode(encoded));
}

export const totpCode = (secret: string, stepOffset = 0): Effect.Effect<string> =>
  Effect.promise(() => {
    const otp = createOTP(secret, { period: TOTP_PERIOD_SECONDS, digits: 6 });
    if (stepOffset === 0) return otp.totp();
    const counter = Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000)) + stepOffset;
    return otp.hotp(counter);
  });

// 固定の誤コードは窓 5 本ぶんの確率で偶然一致する。
export const wrongTotpCode = (secret: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const rejected = yield* Effect.all(
      [-2, -1, 0, 1, 2].map((offset) => totpCode(secret, offset)),
      { concurrency: "unbounded" },
    );
    for (let candidate = 0; candidate < 1000; candidate++) {
      const code = String(candidate).padStart(6, "0");
      if (!rejected.includes(code)) return code;
    }
    return yield* Effect.die(new Error("failed to find a code outside the verification window"));
  });

export const findMfaTotpRow = (userId: string) => TestDb.use((db) => db.readMfaTotp(userId));

export const countMfaTotpRows = (userId: string) =>
  findMfaTotpRow(userId).pipe(Effect.map((row) => (row ? 1 : 0)));

export const countRecoveryCodeRows = (userId: string) =>
  TestDb.use((db) => db.readRecoveryCodes(userId)).pipe(Effect.map((rows) => rows.length));

type EnabledMfaUser = {
  actor: MfaTotpActor;
  secret: string;
  recoveryCodes: string[];
  enrollmentId: string;
  session: TestSession;
};

export const enableMfaFor = (user: { id: string; email: string }) =>
  Effect.gen(function* () {
    const session = yield* createSessionFor(user.id);
    const actor = actorOf(user);
    const enrolled = yield* enroll({ actor });
    const secret = secretFromTotpUri(enrolled.totpUri);
    // timestep は一方向にしか消費できないので、前の step で有効化し現在以降を後続に残す。
    yield* activate({
      actor,
      headers: session.headers,
      code: yield* totpCode(secret, -1),
      enrollmentId: enrolled.enrollmentId,
    });
    // seed の user id は実行ごとに同じで、試行枠が TTL store に 15 分残る。
    yield* resetDisableAttempts(user.id);
    return {
      actor,
      secret,
      recoveryCodes: enrolled.recoveryCodes,
      enrollmentId: enrolled.enrollmentId,
      session,
    } satisfies EnabledMfaUser;
  });

type IssuedChallenge = {
  challengeId: string;
  cookieName: string;
  headers: Headers;
  signedValue: string;
};

const issuedChallengeIds: string[] = [];

export const issueTestChallenge = (challenge: {
  userId: string;
  redirectUrl: string;
  method: ChallengeMethod;
}) =>
  openLoginChallenge(challenge).pipe(
    Effect.map((cookie): IssuedChallenge => {
      const challengeId = cookie.value.slice(0, cookie.value.lastIndexOf("."));
      issuedChallengeIds.push(challengeId);
      return {
        challengeId,
        cookieName: cookie.name,
        signedValue: cookie.value,
        headers: requestHeaders({ [cookie.name]: encodeURIComponent(cookie.value) }),
      };
    }),
  );

const deleteChallengeState = (challengeIds: readonly string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    yield* Effect.forEach(
      challengeIds.flatMap((id) => [challengeKey(id), attemptsKey(id)]),
      (key) => ttlStore.delete(key),
      { concurrency: "unbounded" },
    );
  });

export const cleanupIssuedChallenges = () =>
  deleteChallengeState(issuedChallengeIds).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        issuedChallengeIds.length = 0;
      }),
    ),
  );

// secondaryStorage 構成では session 行が DB に無いので TTL store 上の実体を数える。
export const countLiveSessions = (tokens: string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    const entities = yield* Effect.forEach(tokens, (token) => ttlStore.get(token), {
      concurrency: "unbounded",
    });
    return entities.filter((entity) => entity !== null).length;
  });

export const deleteSessionEntities = (tokens: string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    yield* Effect.forEach(tokens, (token) => ttlStore.delete(token), { concurrency: "unbounded" });
  });

// baseURL 未設定時、better-auth は request の origin を baseURL に使う。
const AUTH_ORIGIN = "http://localhost:3100";

// e2e が同じ行からリンクを取り出す。変えるなら送信側と同時に変える。
const MAGIC_LINK_LOG = "[TEST] Magic Link for";
export const WELCOME_EMAIL_LOG = "[TEST] Welcome email for";

type PrimaryAuthLogin = { response: Response; location: URL | null; logs: string[] };

const handleWithBackgroundTasks = (request: Request) =>
  observing(Effect.promise(() => auth.handler(request))).pipe(
    Effect.map(({ value, logs }) => ({ response: value, logs })),
  );

export const requestMagicLink = (input: { email: string; callbackURL: string }) =>
  Effect.gen(function* () {
    const { logs } = yield* handleWithBackgroundTasks(
      new Request(`${AUTH_ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: input.email, callbackURL: input.callbackURL }),
      }),
    );
    const emailed = logs.find((line) => line.includes(MAGIC_LINK_LOG));
    if (!emailed) return yield* Effect.die(new Error(`no magic link was sent to ${input.email}`));
    return emailed.slice(emailed.indexOf("http"));
  });

export const followMagicLink = (link: string) =>
  handleWithBackgroundTasks(
    new Request(link, {
      headers: { "user-agent": TEST_USER_AGENT, "x-forwarded-for": TEST_CLIENT_IP },
      redirect: "manual",
    }),
  ).pipe(
    Effect.map(({ response, logs }): PrimaryAuthLogin => {
      const location = response.headers.get("location");
      return { response, location: location ? new URL(location) : null, logs };
    }),
  );

// 合成した ctx では after-hook が走らないため実 HTTP 経路を通す。
export const loginWithMagicLink = (input: { email: string; callbackURL: string }) =>
  requestMagicLink(input).pipe(Effect.flatMap(followMagicLink));

export function browserCookieHeaders(response: Response): Headers {
  const pairs = response.headers
    .getSetCookie()
    .filter((cookie) => !/max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => pair.slice(pair.indexOf("=") + 1) !== "");
  return requestHeaders(
    Object.fromEntries(
      pairs.map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
    ),
  );
}

const _mfaTestApi = {
  enableMfaFor,
  createSessionFor,
  issueTestChallenge,
  cleanupIssuedChallenges,
  countLiveSessions,
  deleteSessionEntities,
  requestMagicLink,
  followMagicLink,
  loginWithMagicLink,
  observing,
} satisfies Record<string, (...args: never[]) => Effect.Effect<unknown, unknown, unknown>>;

export { installSentryRecorder } from "../../__tests__/sentry-recorder";
