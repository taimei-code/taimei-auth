import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { UserRepo } from "../../account/ports";
import { AuthApi } from "../../auth-service";
import { captureCause } from "../../sentry";
import { isAtLeast } from "../policy";
import type { Actor } from "../../account/actor-contract";
import { MembershipRepo } from "../ports";
import { Forbidden, NotFound, Unauthorized } from "./errors";

export type { Actor } from "../../account/actor-contract";

const failClosedAsUnauthorized = (failure: { readonly cause: unknown }) =>
  captureCause({ tags: { component: "membership-guard" } })(failure).pipe(
    Effect.andThen(new Unauthorized()),
  );

export const requireActor = Effect.fnUntraced(
  function* (headers: Headers) {
    const session = yield* AuthApi.use((authApi) => authApi.getSession(headers));
    if (!session?.user?.id) return yield* new Unauthorized();
    const dbUser = yield* UserRepo.use((users) => users.findUserById(session.user.id));
    if (!dbUser) return yield* new Unauthorized();
    return {
      id: dbUser.id,
      email: dbUser.email,
      lastUsedCompanyId: dbUser.lastUsedCompanyId,
    } satisfies Actor;
  },
  Effect.catchTag(["AuthApiError", "DbError"], failClosedAsUnauthorized),
);

export const requireMembershipOf = Effect.fnUntraced(function* (
  actor: Actor,
  companyId: string,
  minRole?: Role,
) {
  const membership = yield* MembershipRepo.use((repo) => repo.findMembership(actor.id, companyId));
  if (!membership) return yield* new Forbidden();
  if (minRole && !isAtLeast(membership.role, minRole)) return yield* new Forbidden();
  return membership.role;
});

export const requireTargetMembership = Effect.fnUntraced(function* (
  userId: string,
  companyId: string,
) {
  const membership = yield* MembershipRepo.use((repo) => repo.findMembership(userId, companyId));
  if (!membership) return yield* new NotFound();
  return membership;
});
