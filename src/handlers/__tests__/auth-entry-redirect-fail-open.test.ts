import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Hono } from "hono";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import {
  authFailing,
  membershipRepoLayer,
  userRepoLayer,
} from "../../membership/__tests__/test-layers";
import { SentryLive } from "../../sentry";
import { authEntryRedirectProgram } from "../auth-entry-redirect";

// session-aware redirect は利便であって認可ではないため、better-auth / Redis の transient 障害では 500 を
// 返さず pass-through (SPA) に倒す (login-shortcut と同じ fail-open)。Sentry には warning で残る。
const captured = recordSentryExceptions();

describe("authEntryRedirectProgram (fail-open)", () => {
  test("AuthApi が AuthApiError → undefined (pass-through) と Sentry warning", async () => {
    const cause = new Error("upstash down");
    const app = new Hono();
    let outcome: Response | undefined = new Response("unset");
    app.get("/auth/", async (c) => {
      outcome = await Effect.runPromise(
        Effect.provide(
          authEntryRedirectProgram(c),
          // MembershipRepo は AuthApi 失敗で到達しないが、program の要求型を満たすため空 Layer を渡す。
          Layer.mergeAll(
            authFailing(cause),
            userRepoLayer([]),
            membershipRepoLayer([]),
            SentryLive,
          ),
        ),
      );
      return c.text("ok");
    });
    await app.request("/auth/?service_name=accounts&redirect_url=http://localhost/account");
    expect(outcome).toBeUndefined();
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBe(cause);
    expect(captured[0]?.[1]).toMatchObject({
      level: "warning",
      tags: { handler: "authEntryRedirect" },
    });
  });
});
