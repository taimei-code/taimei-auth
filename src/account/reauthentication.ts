import { Clock, Duration, Effect } from "effect";
import type { ReauthenticationOperation } from "@/db/enums";
import { appendAuditBestEffort } from "../audit/append";
import { getClientContext } from "../request-context";
import type { Actor } from "./actor-contract";
import { ReauthenticationRequired } from "../failures";

const REAUTHENTICATION_WINDOW = Duration.minutes(10);

const isRecentSignIn = (issuedAt: Date, nowMillis: number) =>
  nowMillis - issuedAt.getTime() <= Duration.toMillis(REAUTHENTICATION_WINDOW);

export const requireRecentSignIn = Effect.fnUntraced(function* (input: {
  readonly actor: Pick<Actor, "id">;
  readonly session: { readonly issuedAt: Date };
  readonly operation: ReauthenticationOperation;
  readonly headers: Headers;
}) {
  if (isRecentSignIn(input.session.issuedAt, yield* Clock.currentTimeMillis)) return;
  yield* appendAuditBestEffort({
    eventType: "reauthentication_rejected",
    userId: input.actor.id,
    payload: { operation: input.operation, ...getClientContext(input.headers) },
  });
  return yield* new ReauthenticationRequired();
});
