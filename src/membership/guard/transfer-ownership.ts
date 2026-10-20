import { Effect } from "effect";
import { type Actor, requireMembershipOf, requireTargetMembership } from "./core";
import { AlreadyOwner } from "../errors";
import { InvalidArgument } from "../../failures";

export const requireTransferOwnership = Effect.fnUntraced(function* (opts: {
  actor: Actor;
  companyId: string;
  toUserId: string;
}) {
  if (opts.toUserId === opts.actor.id) return yield* new InvalidArgument({});
  yield* requireMembershipOf(opts.actor, opts.companyId, "OWNER");
  const target = yield* requireTargetMembership(opts.toUserId, opts.companyId);
  if (target.role === "OWNER") return yield* new AlreadyOwner();
  return { actor: opts.actor, toUserId: opts.toUserId };
});
