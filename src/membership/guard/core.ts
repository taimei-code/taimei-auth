import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { captureCause } from "../../sentry";
import { checkSession } from "../../session-check";
import { isAtLeast, type RoleAtLeast } from "../policy";
import type { Actor } from "../../account/actor-contract";
import { MembershipRepo } from "../ports";
import { Forbidden, NotFound, Unauthorized } from "../../failures";
import { type Verified, verified } from "./verified";

export type { Actor } from "../../account/actor-contract";

const failClosedAsUnauthorized = (failure: { readonly cause: unknown }) =>
  captureCause({ tags: { component: "membership-guard" } })(failure).pipe(
    Effect.andThen(new Unauthorized()),
  );

export const requireActor = Effect.fnUntraced(
  function* (headers: Headers) {
    const status = yield* checkSession(headers);
    if (status._tag !== "Active") return yield* new Unauthorized();
    const { user } = status;
    return {
      id: user.id,
      email: user.email,
      lastUsedCompanyId: user.lastUsedCompanyId,
    } satisfies Actor;
  },
  Effect.catchTag(["AuthApiError", "DbError"], failClosedAsUnauthorized),
);

export type VerifiedMember<R extends Role = "MEMBER"> = Verified<{
  readonly actor: Actor;
  readonly companyId: string;
  readonly role: RoleAtLeast<R>;
}>;

export const requireMembershipOf = Effect.fnUntraced(function* <R extends Role>(
  actor: Actor,
  companyId: string,
  minRole: R,
) {
  const membership = yield* MembershipRepo.use((repo) => repo.findMembership(actor.id, companyId));
  if (!membership) return yield* new Forbidden();
  const { role } = membership;
  if (!isAtLeast(role, minRole)) return yield* new Forbidden();
  return verified({ actor, companyId, role }) as VerifiedMember<R>;
});

export const requireTargetMembership = Effect.fnUntraced(function* (
  userId: string,
  companyId: string,
) {
  const membership = yield* MembershipRepo.use((repo) => repo.findMembership(userId, companyId));
  if (!membership) return yield* new NotFound();
  return membership;
});
