import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { auth } from "../auth";
import { CLIENT_IP_HEADER } from "../client-ip";
import { sessionCookieOf } from "../session-cookie";
import { dbTest } from "./live-runner";
import {
  browserCookieHeaders,
  createSessionCookieNotationsFor,
  createSessionFor,
  followMagicLink,
  loginWithMagicLink,
  requestMagicLink,
} from "./session-helpers";
import { TestDb } from "./test-db";

const P = "better-auth-assumptions-test-";
const { run, cleanup } = dbTest(P);

const CALLBACK = "http://localhost:3100/account";

describe("better-auth の既定に頼らず、auth の設定が前提を言い切る", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("better-auth は NODE_ENV=production の時だけ rateLimit を既定で有効にするので、無効を明示する (Magic Link の制限は自前の試行枠が持つ)", async () => {
    expect((await auth.$context).rateLimit.enabled).toBe(false);
  });

  test("session の IP は client が送る x-forwarded-for でなく、入口が決めた IP の header から取る", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("ip"));
        const link = yield* requestMagicLink({ email: user.email, callbackURL: CALLBACK });
        const { response: login } = yield* followMagicLink(link, {
          "x-forwarded-for": "203.0.113.9",
          [CLIENT_IP_HEADER]: "198.51.100.7",
        });

        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: browserCookieHeaders(login) }),
        );
        expect(session?.session.ipAddress).toBe("198.51.100.7");
      }),
    ));

  test("better-auth がログインで発行した session cookie を、session cookie の helper が読める", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("cookie"));
        const { response: login } = yield* loginWithMagicLink({
          email: user.email,
          callbackURL: CALLBACK,
        });

        expect(sessionCookieOf(browserCookieHeaders(login))).toBeString();
      }),
    ));

  test("better-auth は session cookie の値を、そのまま、percent-encode、前後を引用符で囲んだ表記のどれで受けても、同じ id の session を引く。id は session ごとに違い、session token とも違う (試行枠の主体は、この id から作る)", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("notation"));
        const sessionOf = (cookie: string) =>
          Effect.promise(() => auth.api.getSession({ headers: new Headers({ cookie }) })).pipe(
            Effect.map((resolved) => resolved?.session),
          );

        const notated = yield* Effect.forEach(
          Object.values(yield* createSessionCookieNotationsFor(user.id)),
          sessionOf,
        );
        const another = yield* sessionOf((yield* createSessionCookieNotationsFor(user.id)).plain);

        const [first] = notated;
        expect(first?.id).toBeString();
        expect(notated.map((session) => session?.id)).toEqual([first?.id, first?.id, first?.id]);
        expect(another?.id).not.toBe(first?.id);
        expect(first?.id).not.toBe(first?.token);
      }),
    ));

  test.each([
    ["自前の key", () => "rate-limit:magic-link:ip:203.0.113.9"],
    ["利用者ごとの session の一覧の key", (userId: string) => `active-sessions-${userId}`],
  ])("ログイン中の利用者が session token でない %s の失効を求めても、500 にせず何も消さない", (_, tokenOf) =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("revoke"));
        const { headers } = yield* createSessionFor(user.id);
        headers.set("content-type", "application/json");

        const response = yield* Effect.promise(() =>
          auth.handler(
            new Request("http://localhost:3100/api/auth/revoke-session", {
              method: "POST",
              headers,
              body: JSON.stringify({ token: tokenOf(user.id) }),
            }),
          ),
        );
        const session = yield* Effect.promise(() => auth.api.getSession({ headers }));

        expect(response.status).toBe(200);
        expect(session?.user.id).toBe(user.id);
      }),
    ));
  test("ログイン中の利用者は、自分の別の session を session token で失効できる", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("revoke-own"));
        const { headers } = yield* createSessionFor(user.id);
        const other = yield* createSessionFor(user.id);
        headers.set("content-type", "application/json");

        const response = yield* Effect.promise(() =>
          auth.handler(
            new Request("http://localhost:3100/api/auth/revoke-session", {
              method: "POST",
              headers,
              body: JSON.stringify({ token: other.token }),
            }),
          ),
        );
        const revoked = yield* Effect.promise(() =>
          auth.api.getSession({ headers: other.headers }),
        );

        expect(response.status).toBe(200);
        expect(revoked).toBeNull();
      }),
    ));
});
