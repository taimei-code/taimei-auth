import { Effect } from "effect";
import { Hono } from "hono";
import { auth } from "../../src/auth";
import { ATTEMPT_BUDGETS, attemptBudgetKey } from "../../src/attempt-budget";
import { AuthApiError } from "../../src/errors";
import { buildAppWith, requestApp } from "../../src/handlers/__tests__/helpers";
import { mountSpaApi } from "../../src/handlers/spa-http-api";
import { dbTest, auditRowsFor } from "../../src/__tests__/live-runner";
import { browserCookieHeaders, TEST_CLIENT_IP } from "../../src/__tests__/session-helpers";
import { authApiWith } from "../../src/__tests__/test-layers";
import { TestDb } from "../../src/__tests__/test-db";
import { testKvStore } from "../../src/__tests__/test-ttl-store";
import {
  cleanupIssuedChallenges,
  enableMfaFor,
  issueTestChallenge,
  totpCode,
} from "../../src/mfa/__tests__/helpers";

export { TEST_CLIENT_IP, TEST_USER_AGENT } from "../../src/__tests__/session-helpers";

const { run } = dbTest("acc-485-");

export const cleanupMfaChallengeFixtures = () =>
  run(
    Effect.gen(function* () {
      yield* cleanupIssuedChallenges();
      yield* (yield* TestDb).cleanup();
      testKvStore.delete(
        attemptBudgetKey(ATTEMPT_BUDGETS.mfaChallengeVerifyPerIp, TEST_CLIENT_IP),
      );
    }),
  );

type PrimaryMethod = "magic_link" | "github";

const liveApp = (): Hono => {
  const app = new Hono();
  mountSpaApi(app);
  return app;
};

const sessionStoreDownApp = (): Hono =>
  buildAppWith(
    authApiWith(() => ({
      issueSession: () => Effect.fail(new AuthApiError({ cause: new Error("session store down") })),
    })),
  );

const verify = (app: Hono, headers: Headers, code: string) =>
  requestApp(app, "/api/mfa/challenge/verify", {
    method: "POST",
    headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
    body: JSON.stringify({ code, kind: "totp" }),
  });

const observe = (response: Response, userId: string) =>
  Effect.gen(function* () {
    const body: unknown = yield* Effect.promise(() => response.json().catch(() => null));
    const setCookies = response.headers.getSetCookie();
    const session = yield* Effect.promise(() =>
      auth.api.getSession({ headers: browserCookieHeaders(response) }),
    );
    const signInAudits = yield* auditRowsFor(userId, "sign_in");
    return {
      status: response.status,
      body,
      setCookies,
      sessionUserId: session?.user.id ?? null,
      signInPayloads: signInAudits.map((row) => row.payload),
    };
  });

export const passMfaChallenge = (input: { redirectUrl: string; method: PrimaryMethod }) =>
  run(
    Effect.gen(function* () {
      const user = yield* (yield* TestDb).seedUser("pass");
      const enabled = yield* enableMfaFor(user);
      const challenge = yield* issueTestChallenge({ userId: user.id, ...input });
      const response = yield* verify(liveApp(), challenge.headers, yield* totpCode(enabled.secret));
      return { userId: user.id, ...(yield* observe(response, user.id)) };
    }),
  );

export const passMfaChallengeWhileSessionStoreIsDown = () =>
  run(
    Effect.gen(function* () {
      const user = yield* (yield* TestDb).seedUser("down");
      const enabled = yield* enableMfaFor(user);
      const challenge = yield* issueTestChallenge({
        userId: user.id,
        redirectUrl: "/account/security",
        method: "magic_link",
      });
      const response = yield* verify(
        sessionStoreDownApp(),
        challenge.headers,
        yield* totpCode(enabled.secret),
      );
      return yield* observe(response, user.id);
    }),
  );
