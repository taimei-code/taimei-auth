import { Effect } from "effect";
import type { MembershipRow, Role } from "@/db/repositories/membership";
import { UserRepo } from "../../account/ports";
import { AuthApi } from "../../auth-service";
import type { DbError } from "../../errors";
import { captureCause, type SentryService } from "../../sentry";
import { isAtLeast } from "../policy";
import { MembershipRepo } from "../ports";
import { Forbidden, type InvalidArgument, NotFound, Unauthorized } from "./errors";

// ADR-0012 (Guard 層) / ADR-0017 / CONTEXT.md「membership guard」: generic entry の正本。Hono 非依存。
// 依存は ports (Auth / UserRepo / MembershipRepo) を yield* で受け、Effect program として合成する。
// 失敗は errors.ts の failure class を E channel に載せ、adapter (handlers/run-route.ts) が wire に写像する。

// 列は「hot path の再 SELECT を消す」目的でのみ足す (requireActor が毎 request user 行を読むため)。
// 表示用途 (name / image) では足さない。
export type Actor = {
  id: string;
  email: string;
  lastUsedCompanyId: string | null;
};

// operation 単位 entry が受け取る body parse。Effect 値は yield* されるまで実行されないため、
// 401 / 403 が先行した request では body を読まない (zod schema は Transport 側に残す)。
export type ParseBody<T> = Effect.Effect<T, InvalidArgument>;

const failClosedAsUnauthorized = (failure: {
  readonly cause: unknown;
}): Effect.Effect<never, Unauthorized, SentryService> =>
  captureCause({ tags: { component: "membership-guard" } })(failure).pipe(
    Effect.flatMap(() => Effect.fail(new Unauthorized())),
  );

// session 解決は fail-closed: better-auth / user 行読み取りの失敗 (AuthApiError / DbError) は Sentry に
// 残したうえで Unauthorized に倒す。障害と未認証が同じ 401 になるため、障害側だけ Sentry に記録する。
// better-auth cookieCache (最大 5 分) は user 行削除後も session を返すため、DB の user 存在で fail-closed
// にする (削除済み user を通すと membership insert が FK 違反 500 になる)。
export const requireActor = (
  headers: Headers,
): Effect.Effect<Actor, Unauthorized, AuthApi | UserRepo | SentryService> =>
  Effect.gen(function* () {
    const authApi = yield* AuthApi;
    const users = yield* UserRepo;
    const session = yield* authApi.getSession(headers);
    if (!session?.user?.id) return yield* new Unauthorized();
    const dbUser = yield* users.findById(session.user.id);
    if (!dbUser) return yield* new Unauthorized();
    return { id: dbUser.id, email: dbUser.email, lastUsedCompanyId: dbUser.lastUsedCompanyId };
  }).pipe(
    Effect.catchTags({
      AuthApiError: failClosedAsUnauthorized,
      DbError: failClosedAsUnauthorized,
    }),
  );

// membership の読み取り失敗 (DbError) は捕捉せず伝播させ 500 にする (fail-closed の対象は session 解決のみ)。
// identity DB の RPC 化時に auth 断→401 / membership 断→500 の非対称を再判断する。
// 401→400→403 の順序を保つ route が requireActor と別に呼ぶ (401 と 403 の間に body parse 400 を挟む)。
export const requireMembershipOf = (
  actor: Actor,
  companyId: string,
  minRole?: Role,
): Effect.Effect<Role, Forbidden | DbError, MembershipRepo> =>
  Effect.gen(function* () {
    const repo = yield* MembershipRepo;
    const membership = yield* repo.findMembership(actor.id, companyId);
    if (!membership) return yield* new Forbidden();
    // 未知 role は fail-closed で 403 に倒す (isAtLeast が own-property 判定で未知 role を false に落とす)。
    if (minRole && !isAtLeast(membership.role, minRole)) return yield* new Forbidden();
    return membership.role;
  });

export const requireMembership = (
  headers: Headers,
  companyId: string,
  minRole?: Role,
): Effect.Effect<
  { actor: Actor; role: Role },
  Unauthorized | Forbidden | DbError,
  AuthApi | UserRepo | MembershipRepo | SentryService
> =>
  Effect.gen(function* () {
    const actor = yield* requireActor(headers);
    const role = yield* requireMembershipOf(actor, companyId, minRole);
    return { actor, role };
  });

// operation 単位 entry が共有する target 側の解決 (null → 404)。
export const requireTargetMembership = (
  userId: string,
  companyId: string,
): Effect.Effect<MembershipRow, NotFound | DbError, MembershipRepo> =>
  Effect.gen(function* () {
    const repo = yield* MembershipRepo;
    const membership = yield* repo.findMembership(userId, companyId);
    if (!membership) return yield* new NotFound();
    return membership;
  });
