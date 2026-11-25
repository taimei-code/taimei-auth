import { afterAll, describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { buildApp } from "../../src/app";
import { getTrustedOrigins } from "../../src/env";
import { dbTest } from "../../src/__tests__/live-runner";
import { browserCookieHeaders, sessionUserIdOf } from "../../src/__tests__/session-helpers";
import { requestApp, responseJson } from "../../src/handlers/__tests__/helpers";
import { TestDb } from "../../src/__tests__/test-db";
import { authHostOrigin } from "../auth-host-origin";
import { e2eLoginLinkRoutes } from "../e2e-login-links";

const { run, cleanup } = dbTest("login-links-test-");
const [trustedOrigin] = getTrustedOrigins();
if (trustedOrigin === undefined) {
  throw new Error("AUTH_TRUSTED_ORIGINS is empty; the testing API refuses every returnTo");
}
const RETURN_TO = `${trustedOrigin}/account`;

const app = buildApp({ mountStatic: () => {} });
app.route("/", e2eLoginLinkRoutes());

const requestLoginLink = (body: { email: string; returnTo: string }) =>
  requestApp(app, `${TESTING_PATH}/login-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

afterAll(cleanup);

describe("e2e は、既存の利用者の email でログイン URL を受け取り、画面から Magic Link を送らずにログインする", () => {
  test("既存の利用者の email と trusted な returnTo を送ると、開くとその利用者でログインした状態になる URL を返す", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("existing");

        const response = yield* requestLoginLink({ email: user.email, returnTo: RETURN_TO });
        expect(response.status).toBe(200);
        const { loginUrl } = (yield* responseJson(response)) as { loginUrl: string };

        const url = new URL(loginUrl);
        const opened = yield* requestApp(app, `${url.pathname}${url.search}`);
        expect(opened.headers.get("location")).toBe(RETURN_TO);
        expect(yield* sessionUserIdOf(browserCookieHeaders(opened))).toBe(user.id);
      }),
    ));

  test("trusted でない origin の returnTo は 400", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("untrusted");
        const response = yield* requestLoginLink({
          email: user.email,
          returnTo: "https://attacker.example/",
        });
        expect(response.status).toBe(400);
      }),
    ));
});

describe("e2e は、ログイン中の session を古くして、再認証が要る状態を待たずに作る", () => {
  const signedInCookie = (email: string) =>
    Effect.gen(function* () {
      const response = yield* requestLoginLink({ email, returnTo: RETURN_TO });
      const { loginUrl } = (yield* responseJson(response)) as { loginUrl: string };
      const url = new URL(loginUrl);
      return browserCookieHeaders(yield* requestApp(app, `${url.pathname}${url.search}`));
    });

  const ageSession = (headers: Headers, issuedSecondsAgo: number, origin = authHostOrigin()) =>
    requestApp(app, `${TESTING_PATH}/session-age`, {
      method: "POST",
      headers: {
        ...Object.fromEntries(headers),
        "Content-Type": "application/json",
        origin,
      },
      body: JSON.stringify({ issuedSecondsAgo }),
    });

  const startMfaEnrollment = (headers: Headers) =>
    requestApp(app, "/api/account/mfa/enroll", {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "sec-fetch-site": "same-origin" },
    });

  test("ログイン中の session を発行から 601 秒経ったことにすると、同じ session の MFA の登録は再認証が要る失敗になる", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("aged");
        const cookie = yield* signedInCookie(user.email);

        expect((yield* ageSession(cookie, 601)).status).toBe(204);
        const enrollment = yield* startMfaEnrollment(cookie);

        expect(enrollment.status).toBe(403);
        expect(yield* responseJson(enrollment)).toEqual({ _tag: "ReauthenticationRequired" });
        expect(yield* sessionUserIdOf(cookie)).toBe(user.id);
      }),
    ));

  test("発行から 60 秒経ったことにした session は、MFA の登録を始められる", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("recent");
        const cookie = yield* signedInCookie(user.email);

        expect((yield* ageSession(cookie, 60)).status).toBe(204);

        expect((yield* startMfaEnrollment(cookie)).status).toBe(200);
      }),
    ));

  test("auth ホストでない Origin からの要求は、session を古くせずに 403 になる", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("cross-site");
        const cookie = yield* signedInCookie(user.email);

        const response = yield* ageSession(cookie, 601, "https://attacker.example");

        expect(response.status).toBe(403);
        expect((yield* startMfaEnrollment(cookie)).status).toBe(200);
      }),
    ));

  test("ログインしていない要求は、session を古くできずに 403 になる", () =>
    run(
      Effect.gen(function* () {
        const response = yield* ageSession(new Headers(), 601);

        expect(response.status).toBe(403);
      }),
    ));

  test("1 年を超える秒数は受け付けず 400 になり、session は古くならない", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("too-old");
        const cookie = yield* signedInCookie(user.email);

        expect((yield* ageSession(cookie, 365 * 24 * 60 * 60 + 1)).status).toBe(400);
        expect((yield* startMfaEnrollment(cookie)).status).toBe(200);
      }),
    ));
});
