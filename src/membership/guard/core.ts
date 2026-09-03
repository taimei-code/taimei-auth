import { auth } from "../../auth";
import { Sentry } from "../../sentry";
import { isAtLeast } from "../policy";
import { findMembership, type Role } from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";

// ADR-0012 (Guard 層) / CONTEXT.md「membership guard」: generic entry と Result 型の正本。Hono 非依存。

// 列は「hot path の再 SELECT を消す」目的でのみ足す (getActor が毎 request user 行を読むため)。
// 表示用途 (name / image) では足さない。
export type Actor = {
  id: string;
  email: string;
  lastUsedCompanyId: string | null;
};

export type Unauthorized = { ok: false; error: "unauthorized"; status: 401 };
export type Forbidden = { ok: false; error: "forbidden"; status: 403 };
export type NotFound = { ok: false; error: "not_found"; status: 404 };
export type InvalidArgument = {
  ok: false;
  error: "invalid_argument";
  status: 400;
  details?: unknown;
};

export type ActorResult = { ok: true; actor: Actor } | Unauthorized;

type MembershipOnlyResult = { ok: true; role: Role } | Forbidden;

// operation 単位 entry の parseBody callback 契約。zod schema は Transport 側に残す。details は
// invalid_argument に details を付ける 3 route (signup 作成 / add / 招待作成) のみ non-undefined。
export type ParseBodyResult<T> = { ok: true; data: T } | { ok: false; details?: unknown };

export type ParseBodyCallback<T> = () => Promise<ParseBodyResult<T>> | ParseBodyResult<T>;

export async function resolveParseBody<T>(
  parseBody: ParseBodyCallback<T>,
): Promise<{ ok: true; data: T } | InvalidArgument> {
  const parsed = await parseBody();
  if (parsed.ok) return parsed;
  const invalid: InvalidArgument = { ok: false, error: "invalid_argument", status: 400 };
  if (parsed.details !== undefined) invalid.details = parsed.details;
  return invalid;
}

export type MembershipGuardResult =
  | { ok: true; actor: Actor; role: Role }
  | Unauthorized
  | Forbidden;

// deps に per-request でしか持てないリソース (pg.Pool 実体等) を bind しない。findMembership を
// module ロード時 bind してよい理由は db/CLAUDE.md の workerd gotcha (RoutingPool / PR #91)。
export type GuardDeps = {
  getActor: (headers: Headers) => Promise<Actor | null>;
  // findMembership の throw は伝播させ 500 にする (fail-closed の対象は session 解決のみ)。
  // identity DB の RPC 化時に auth 断→401 / membership 断→500 の非対称を再判断する。
  findMembership: typeof findMembership;
};

export function createMembershipGuard(deps: GuardDeps) {
  const requireActor = async (headers: Headers): Promise<ActorResult> => {
    // getActor の失敗は null に倒し 401 にする (auth は fail-closed)。.then に包むのは非 async な
    // getActor の同期 throw も拾うため — 直接 .catch() だと装着前に伝播して 500 = fail-open になる。
    // 障害と未認証が同じ 401 になるため、障害側は Sentry に残す。
    const actor = await Promise.resolve()
      .then(() => deps.getActor(headers))
      .catch((error: unknown) => {
        Sentry.captureException(error, { tags: { component: "membership-guard" } });
        return null;
      });
    if (!actor) return { ok: false, error: "unauthorized", status: 401 };
    return { ok: true, actor };
  };

  // 401→400→403 の順序を保つ route が requireActor と別に呼ぶ (401 と 403 の間に body parse 400 を挟む)。
  const requireMembershipOf = async (
    actor: Actor,
    companyId: string,
    minRole?: Role,
  ): Promise<MembershipOnlyResult> => {
    const membership = await deps.findMembership(actor.id, companyId);
    if (!membership) return { ok: false, error: "forbidden", status: 403 };
    // 未知 role は fail-closed で 403 に倒す (isAtLeast が own-property 判定で未知 role を false に落とす)。
    if (minRole && !isAtLeast(membership.role, minRole)) {
      return { ok: false, error: "forbidden", status: 403 };
    }
    return { ok: true, role: membership.role };
  };

  const requireMembership = async (
    headers: Headers,
    companyId: string,
    minRole?: Role,
  ): Promise<MembershipGuardResult> => {
    const actorResult = await requireActor(headers);
    if (!actorResult.ok) return actorResult;
    const membershipResult = await requireMembershipOf(actorResult.actor, companyId, minRole);
    if (!membershipResult.ok) return membershipResult;
    return { ok: true, actor: actorResult.actor, role: membershipResult.role };
  };

  return { requireActor, requireMembershipOf, requireMembership };
}

export type MembershipGuard = ReturnType<typeof createMembershipGuard>;

export const guard: MembershipGuard = createMembershipGuard({
  getActor: async (headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) return null;
    // better-auth cookieCache (最大 5 分) は user 行削除後も session を返す。削除済み user を通すと
    // membership insert が FK 違反 500 になるため DB の user 存在で fail-closed (auth-handler.ts と同様)。
    const dbUser = await findUserById(session.user.id);
    return dbUser
      ? {
          id: dbUser.id,
          email: dbUser.email,
          lastUsedCompanyId: dbUser.lastUsedCompanyId,
        }
      : null;
  },
  findMembership,
});
