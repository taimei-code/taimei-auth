import { describe, expect, test } from "bun:test";
import { Layer } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import {
  authFailing,
  membershipRepoLayer,
  userRepoLayer,
} from "../../membership/__tests__/test-layers";
import { SentryLive } from "../../sentry";
import { authEntryRedirectProgram } from "../auth-entry-redirect";
import { runProgramInRoute } from "./run-program-in-route";

const captured = recordSentryExceptions();

describe("authEntryRedirectProgram (fail-open)", () => {
  test("AuthApi が AuthApiError → undefined (pass-through) と Sentry warning", async () => {
    const cause = new Error("upstash down");
    const outcome = await runProgramInRoute(
      "/auth/",
      "/auth/?service_name=accounts&redirect_url=http://localhost/account",
      authEntryRedirectProgram,
      Layer.mergeAll(authFailing(cause), userRepoLayer([]), membershipRepoLayer([]), SentryLive),
    );
    expect(outcome).toBeUndefined();
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBe(cause);
    expect(captured[0]?.[1]).toMatchObject({
      level: "warning",
      tags: { handler: "authEntryRedirect" },
    });
  });
});
