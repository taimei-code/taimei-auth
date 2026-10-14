import { Clock, Effect } from "effect";
import { appendAuditBestEffort, signInEntry } from "../audit/append";
import { Background } from "../background";
import { EmailSender } from "../email/ports";
import { toDisplayText } from "../email/sanitize";
import { captureCause } from "../sentry";
import type { PrimaryAuthRoute } from "./primary-auth-routes";

export const NEW_USER_THRESHOLD_MS = 10000;

type SignedIn = {
  user: { id: string; email: string; name: string; createdAt: Date | string };
  route: PrimaryAuthRoute;
  headers: Headers | null | undefined;
};

export const observeSignInProgram = Effect.fnUntraced(function* (input: SignedIn) {
  const { user } = input;
  const background = yield* Background;
  const email = yield* EmailSender;
  const now = yield* Clock.currentTimeMillis;

  if (now - new Date(user.createdAt).getTime() < NEW_USER_THRESHOLD_MS) {
    yield* background.run(
      email
        .sendWelcome(user.email, toDisplayText(user.name))
        .pipe(Effect.catch(captureCause({ tags: { component: "welcome-email" } }))),
    );
  }

  if (input.route._tag === "Unmapped") return;

  yield* background.run(
    appendAuditBestEffort(signInEntry(user.id, input.route.method, input.headers)),
  );
});
