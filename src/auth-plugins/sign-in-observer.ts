import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { Clock, Effect } from "effect";
import { appendAuditLogBestEffort } from "../audit/report-failure";
import { Background } from "../background";
import { EmailSender } from "../email/ports";
import { getClientContext } from "../request-context";
import {
  isPrimaryAuthRoute,
  parsePrimaryAuthRoute,
  type PrimaryAuthRoute,
} from "./primary-auth-routes";

// mfa-challenge の後に登録し、null 化された newSession でスキップする。登録順が前提 (ADR-0013)。

const NEW_USER_THRESHOLD_MS = 10000;

type SignedIn = {
  user: { id: string; email: string; name: string; createdAt: Date | string };
  route: PrimaryAuthRoute;
  headers: Headers | null | undefined;
};

const observe = Effect.fn("auth.observeSignIn")(function* (input: SignedIn) {
  const { user } = input;
  const background = yield* Background;
  const email = yield* EmailSender;
  const now = yield* Clock.currentTimeMillis;

  if (now - new Date(user.createdAt).getTime() < NEW_USER_THRESHOLD_MS) {
    // Workers では fire-and-forget を waitUntil 経由にしないと "hung" になる。
    yield* background.run(
      email
        .sendWelcome(user.email, user.name)
        .pipe(Effect.catch((e) => Effect.logError("Welcome email failed:", e.cause))),
    );
  }

  if (input.route._tag === "Unmapped") return;

  // 型付き property へ call 結果や spread を渡すと excess-property check が効かず増分が黙って載る。
  const { ip, userAgent } = getClientContext(input.headers);
  yield* background.run(
    appendAuditLogBestEffort({
      eventType: "sign_in",
      userId: user.id,
      payload: { method: input.route.method, ip, userAgent },
    }),
  );
});

const observeSignIn = createAuthMiddleware(async (ctx) => {
  const establishedSession = ctx.context.newSession;
  if (!establishedSession) return;
  const { getRuntime } = await import("../runtime");
  await getRuntime().runPromise(
    observe({
      user: establishedSession.user,
      route: parsePrimaryAuthRoute(ctx.path, ctx.params),
      headers: ctx.headers,
    }),
  );
});

export const signInObserver = (): BetterAuthPlugin => ({
  id: "sign-in-observer",
  hooks: {
    after: [
      {
        matcher: (ctx) => isPrimaryAuthRoute(ctx.path),
        handler: observeSignIn,
      },
    ],
  },
});
