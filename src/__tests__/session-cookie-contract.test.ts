import { afterAll, describe, expect, test } from "bun:test";
import {
  buildSessionCookieHeader,
  extractSessionTokenFromCookieHeader,
} from "@taimei-code/auth-client";
import { Effect } from "effect";
import { auth } from "../auth";
import { AuthApi } from "../auth-service";
import {
  deleteSessionEntities,
  issuedSessionSetCookies,
  loginWithMagicLink,
  SIGNED_COOKIE_VALUE,
  setCookieValue,
} from "../mfa/__tests__/helpers";
import { MfaSessions } from "../mfa/totp/ports";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";

// session cookie 契約 (CONTEXT.md「session cookie」) — 発行者が 2 つ (better-auth 本体 / src/mfa/gateway.ts) あっても
// 値は同じ形 (percent-encoded の署名付き値) で、SDK 素通しで server が受理し、属性は 2 発行者で同一
// (QA-MR-01 が実ブラウザで見る対象のうち発行者間の差)。
// gateway へは MfaSessions port (production の結線) で到達し、gateway を直接 import しない (containment AC-150a)。
// test env は local 判定のため Secure / Domain は付かず、同一性の証明は Max-Age / Path / HttpOnly / SameSite に限る。

const { run, cleanup } = dbTest("cookie-contract-");
const CONSUMER_CALLBACK = "https://app.example.com/dashboard";

// hono serialize (gateway が属性を渡す先) が扱う CookieOptions の key。better-auth がこれ以外の key を足すと
// gateway 経由の cookie だけ黙って落ちるので、T3 が先に落ちる。
const HANDLED_ATTRIBUTE_KEYS = [
  "domain",
  "expires",
  "httpOnly",
  "maxAge",
  "partitioned",
  "path",
  "prefix",
  "priority",
  "sameSite",
  "secure",
];
const isSubsetOfHandledKeys = (attributes: object) =>
  Object.keys(attributes).every((key) => HANDLED_ATTRIBUTE_KEYS.includes(key));
// module 評価時に $context を待たない (reject した時の handler が T3 まで無く、file 全体が unhandled で落ちる)。
const sessionCookieAttributes = () =>
  auth.$context.then((context) => context.createAuthCookie("session_token").attributes);

// ブラウザが送り返す request の Cookie header は Set-Cookie の先頭 pair と同じ形。
const asRequestCookieHeader = (setCookie: string) => setCookie.split(";")[0];
// Redis の session key は署名を除いた token。
const tokenWithoutSignature = (value: string) => {
  const decoded = decodeURIComponent(value);
  return decoded.slice(0, decoded.lastIndexOf("."));
};
// wire 上の値は percent-encoded で、decode すると署名付き値の形になる。
const expectEncodedSignedValue = (value: string) => {
  expect(value).toBe(encodeURIComponent(decodeURIComponent(value)));
  expect(decodeURIComponent(value)).toMatch(SIGNED_COOKIE_VALUE);
};

// 先頭 pair を落とし、Max-Age は数値を捨てて key だけにする (両発行者で 1 秒ずれうる)。
const attributeSet = (setCookie: string) =>
  new Set(
    setCookie
      .split(";")
      .slice(1)
      .map((part) => part.trim())
      .map((part) => (part.startsWith("Max-Age=") ? "Max-Age" : part)),
  );

// 発行した session は Redis にしか無いので、test が消す (TTL 7 日を待たない)。
const issuedTokens: string[] = [];
const rememberForCleanup = (setCookies: string[]) => {
  issuedTokens.push(...setCookies.map((cookie) => tokenWithoutSignature(setCookieValue(cookie))));
  return setCookies;
};

const issueViaGateway = (userId: string) =>
  Effect.gen(function* () {
    const headers = yield* (yield* MfaSessions).issueSession(userId);
    return rememberForCleanup(yield* issuedSessionSetCookies(headers));
  });

afterAll(async () => {
  await run(deleteSessionEntities(issuedTokens));
  await cleanup();
});

describe("T1 発行 → SDK が読む → RPC 形式で戻す → server が検証", () => {
  test("gateway は session cookie をちょうど 1 本、percent-encoded の署名付き値で発行する", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("t1-shape");
        const cookies = yield* issueViaGateway(user.id);
        expect(cookies.length).toBe(1);
        expectEncodedSignedValue(setCookieValue(cookies[0]));
      }),
    ));

  test("SDK が抽出した値を Cookie header に戻すと AuthApi.getSession が同じ user を返す", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("t1-roundtrip");
        const [issued] = yield* issueViaGateway(user.id);
        const extracted = extractSessionTokenFromCookieHeader(asRequestCookieHeader(issued));
        expect(extracted).toBe(setCookieValue(issued));
        const headers = new Headers({ cookie: buildSessionCookieHeader(extracted ?? "") });
        const session = yield* (yield* AuthApi).getSession(headers);
        expect(session?.user.id).toBe(user.id);
      }),
    ));

  test("better-auth 本体 (magic link ログイン) の percent-encoded な値も SDK 素通しで同じ user を返す", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("t1-primary-roundtrip");
        const login = yield* loginWithMagicLink({
          email: user.email,
          callbackURL: CONSUMER_CALLBACK,
        });
        const [issued] = rememberForCleanup(yield* issuedSessionSetCookies(login.response.headers));
        const extracted = extractSessionTokenFromCookieHeader(asRequestCookieHeader(issued));
        expect(extracted).toBe(setCookieValue(issued));
        const headers = new Headers({ cookie: buildSessionCookieHeader(extracted ?? "") });
        const session = yield* (yield* AuthApi).getSession(headers);
        expect(session?.user.id).toBe(user.id);
      }),
    ));
});

describe("T2 2 発行者の値の形と属性同一性", () => {
  test("better-auth 本体の値も percent-encoded の署名付き値 (gateway と同じ形)", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("t2-primary-shape");
        const login = yield* loginWithMagicLink({
          email: user.email,
          callbackURL: CONSUMER_CALLBACK,
        });
        const [issued] = rememberForCleanup(yield* issuedSessionSetCookies(login.response.headers));
        // ここが落ちたら better-call の serializer が変わった。
        expectEncodedSignedValue(setCookieValue(issued));
      }),
    ));

  test("gateway の Set-Cookie は better-auth 本体 (magic link ログイン) と同じ属性集合を持つ", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const gatewayUser = yield* db.seedUser("t2-gateway");
        const [viaGateway] = yield* issueViaGateway(gatewayUser.id);

        const primaryUser = yield* db.seedUser("t2-primary");
        const login = yield* loginWithMagicLink({
          email: primaryUser.email,
          callbackURL: CONSUMER_CALLBACK,
        });
        const viaPrimary = rememberForCleanup(
          yield* issuedSessionSetCookies(login.response.headers),
        );
        expect(viaPrimary.length).toBe(1);

        expect(attributeSet(viaGateway)).toEqual(attributeSet(viaPrimary[0]));
      }),
    ));

  test("Max-Age の数値は比較に含めない", () => {
    expect(attributeSet("n=v; Max-Age=604799; Path=/")).toEqual(
      attributeSet("n=v; Max-Age=604800; Path=/"),
    );
    expect([...attributeSet("n=v; Max-Age=604799")]).toEqual(["Max-Age"]);
  });
});

describe("T3 better-auth の cookie 属性 key は hono serialize が扱う key に収まる", () => {
  test("createAuthCookie の attributes の key 集合", async () => {
    expect(isSubsetOfHandledKeys(await sessionCookieAttributes())).toBe(true);
  });

  test("判定は未知の key で不一致になる (tripwire の検出力)", async () => {
    expect(isSubsetOfHandledKeys({ ...(await sessionCookieAttributes()), chunked: true })).toBe(
      false,
    );
  });
});
