import { Effect } from "effect";
import { type Actor, requireMembershipOf, requireTargetMembership } from "./core";
import { AlreadyOwner } from "../errors";
import { InvalidArgument } from "../../failures";
import { type Verified, verified } from "./verified";

export type OwnershipTransferGrant = Verified<{
  readonly actor: Actor;
  readonly companyId: string;
  readonly toUserId: string;
}>;

export const requireTransferOwnership = Effect.fnUntraced(function* (opts: {
  actor: Actor;
  companyId: string;
  toUserId: string;
}) {
  if (opts.toUserId === opts.actor.id) return yield* new InvalidArgument({});
  yield* requireMembershipOf(opts.actor, opts.companyId, "OWNER");
  const target = yield* requireTargetMembership(opts.toUserId, opts.companyId);
  if (target.role === "OWNER") return yield* new AlreadyOwner();
  return verified({
    actor: opts.actor,
    companyId: opts.companyId,
    toUserId: opts.toUserId,
  }) satisfies OwnershipTransferGrant;
});
