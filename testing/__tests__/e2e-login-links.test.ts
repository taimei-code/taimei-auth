import { afterAll, describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { buildApp } from "../../src/app";
import { getTrustedOrigins } from "../../src/env";
import { dbTest } from "../../src/__tests__/live-runner";
import { browserCookieHeaders, sessionUserIdOf } from "../../src/__tests__/session-helpers";
import { requestApp, responseJson } from "../../src/handlers/__tests__/helpers";
import { TestDb } from "../../src/__tests__/test-db";
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
