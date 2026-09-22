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

// テスト環境は local 判定で Secure と Domain が付かないため、同一性の証明は Max-Age、Path、HttpOnly、SameSite に限る。
const { run, cleanup } = dbTest("cookie-contract-");
const CONSUMER_CALLBACK = "https://app.example.com/dashboard";

// hono の serialize が扱う CookieOptions の key。better-auth がこれ以外を足すと gateway 経由の cookie だけが欠けるので T3 で先に落とす。
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
// module 評価時に $context を待たない (reject 時の handler が無く、ファイル全体が unhandled で落ちる)。
const sessionCookieAttributes = () =>
  auth.$context.then((context) => context.createAuthCookie("session_token").attributes);

const asRequestCookieHeader = (setCookie: string) => setCookie.split(";")[0];
const tokenWithoutSignature = (value: string) => {
  const decoded = decodeURIComponent(value);
  return decoded.slice(0, decoded.lastIndexOf("."));
};
const expectEncodedSignedValue = (value: string) => {
  expect(value).toBe(encodeURIComponent(decodeURIComponent(value)));
  expect(decodeURIComponent(value)).toMatch(SIGNED_COOKIE_VALUE);
};

// Max-Age は 2 発行者で 1 秒ずれることがあるので key だけにする。
const attributeSet = (setCookie: string) =>
  new Set(
    setCookie
      .split(";")
      .slice(1)
      .map((part) => part.trim())
      .map((part) => (part.startsWith("Max-Age=") ? "Max-Age" : part)),
  );

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
