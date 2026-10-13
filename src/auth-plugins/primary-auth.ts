import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { isMfaChallengeEnabled } from "../mfa/kill-switch";
import type { AppRuntime } from "../runtime";
import {
  type ChallengeDecision,
  challengeWith,
  PASS,
  enforceChallenge,
  MFA_CHALLENGE_PAGE,
} from "./mfa-challenge";
import { isPrimaryAuthRoute, parsePrimaryAuthRoute } from "./primary-auth-routes";
import { observeSignInProgram } from "./sign-in-observer";

const afterPrimaryAuth = (runtime: AppRuntime) =>
  createAuthMiddleware(async (ctx) => {
    const issued = ctx.context.newSession;
    if (!issued) return;
    const route = parsePrimaryAuthRoute(ctx.path, ctx.params);
    const challengeEnabled = isMfaChallengeEnabled(process.env.MFA_CHALLENGE_ENABLED);

    let decision: ChallengeDecision;
    try {
      decision = await runtime.runPromise(
        enforceChallenge({
          userId: issued.user.id,
          sessionToken: issued.session.token,
          route,
          location: ctx.context.responseHeaders?.get("location"),
          challengeEnabled,
        }),
      );
    } catch (error) {
      console.error("[mfa-challenge] runtime unavailable", error);
      decision = challengeEnabled ? challengeWith(null) : PASS;
    }
    if (decision._tag === "Challenge") {
      deleteSessionCookie(ctx, true);
      ctx.context.setNewSession(null);
      if (decision.cookie)
        ctx.setCookie(decision.cookie.name, decision.cookie.value, decision.cookie.attributes);
      throw ctx.redirect(new URL(MFA_CHALLENGE_PAGE, ctx.context.baseURL).toString());
    }

    await runtime.runPromise(
      observeSignInProgram({ user: issued.user, route, headers: ctx.headers }),
    );
  });

export const primaryAuth = (runtime: AppRuntime): BetterAuthPlugin => ({
  id: "primary-auth",
  hooks: {
    after: [{ matcher: (ctx) => isPrimaryAuthRoute(ctx.path), handler: afterPrimaryAuth(runtime) }],
  },
});
