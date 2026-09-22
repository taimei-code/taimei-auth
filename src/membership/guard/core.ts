import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { UserRepo } from "../../account/ports";
import { AuthApi } from "../../auth-service";
import { captureCause } from "../../sentry";
import { isAtLeast } from "../policy";
import { MembershipRepo } from "../ports";
import { Forbidden, type InvalidArgument, NotFound, Unauthorized } from "./errors";

export type Actor = {
  id: string;
  email: string;
  lastUsedCompanyId: string | null;
};

export type ParseBody<T> = Effect.Effect<T, InvalidArgument>;

const failClosedAsUnauthorized = (failure: { readonly cause: unknown }) =>
  captureCause({ tags: { component: "membership-guard" } })(failure).pipe(
    Effect.andThen(new Unauthorized()),
  );

// better-auth の cookieCache (最大 5 分) は user 行の削除後も session を返すため、DB に user が存在しなければ fail-closed にする。
export const requireActor = Effect.fn("membership.requireActor")(
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

// membership の読み取り失敗 (DbError) は捕捉せず 500 にする (fail-closed にするのは session の解決だけ)。
export const requireMembershipOf = Effect.fn("membership.requireMembershipOf")(function* (
  actor: Actor,
  companyId: string,
  minRole?: Role,
) {
  const membership = yield* MembershipRepo.use((repo) => repo.findMembership(actor.id, companyId));
  if (!membership) return yield* new Forbidden();
  if (minRole && !isAtLeast(membership.role, minRole)) return yield* new Forbidden();
  return membership.role;
});

export const requireMembership = Effect.fn("membership.requireMembership")(function* (
  headers: Headers,
  companyId: string,
  minRole?: Role,
) {
  const actor = yield* requireActor(headers);
  const role = yield* requireMembershipOf(actor, companyId, minRole);
  return { actor, role };
});

export const requireTargetMembership = Effect.fn("membership.requireTargetMembership")(function* (
  userId: string,
  companyId: string,
) {
  const membership = yield* MembershipRepo.use((repo) => repo.findMembership(userId, companyId));
  if (!membership) return yield* new NotFound();
  return membership;
});
