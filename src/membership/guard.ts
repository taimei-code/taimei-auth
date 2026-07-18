import { auth } from "../auth";
import { findMembership, type MembershipRow, type Role } from "@/db/repositories/membership";

// SPA 向け Hono ルートの RBAC ガードを 1 module に集約する。handler は Result を受けて
// `if (!r.ok) return c.json({ error: r.error }, r.status)` の 2 行で HTTP に写像するだけにし、
// session→membership→role→403 の 4 ステップが各 route にコピペで散るのを防ぐ。Hono には依存しない。

export type Actor = { id: string; email: string };

type Unauthorized = { ok: false; error: "unauthorized"; status: 401 };
type Forbidden = { ok: false; error: "forbidden"; status: 403 };

export type ActorResult = { ok: true; actor: Actor } | Unauthorized;

export type MembershipOnlyResult = { ok: true; membership: MembershipRow } | Forbidden;

export type MembershipGuardResult =
  | { ok: true; actor: Actor; membership: MembershipRow }
  | Unauthorized
  | Forbidden;

// OWNER > ADMIN > MEMBER の全順序。minRole 比較を「以上」で書けるようにする。export しないのは
// 直接 index lookup を外へ漏らすと未知 role の素通しを再現するため。判定は isAtLeast に閉じる。
const ROLE_LEVEL = { MEMBER: 0, ADMIN: 1, OWNER: 2 } as const;

// role が Role の値でない (unknown 文字列 or Object.prototype 上のキー名) 場合は false。
// role 列は text で型保証がなく、prototype チェーン経由の lookup が role を素通しさせる罠を防ぐ。
export function isAtLeast(role: string, minRole: Role): boolean {
  if (!Object.hasOwn(ROLE_LEVEL, role)) return false;
  return ROLE_LEVEL[role as Role] >= ROLE_LEVEL[minRole];
}

// role が Role 値集合に属するかの判定。未知 role の target を保守側に倒す policy 用。
function isKnownRole(role: string): role is Role {
  return Object.hasOwn(ROLE_LEVEL, role);
}

// role 変更の可否: before/next のどちらかが OWNER に触れる変更は OWNER のみ許可 (ADMIN は
// OWNER への昇格も OWNER の降格も承認できない)。OWNER に触れない変更は所属していれば可。
// 未知の beforeRole は保守側 (OWNER 相当) に扱い、ADMIN の任意操作を許さない。
export function canChangeRole(actorRole: Role, beforeRole: Role, nextRole: Role): boolean {
  const touchesOwner = !isKnownRole(beforeRole) || beforeRole === "OWNER" || nextRole === "OWNER";
  return touchesOwner ? actorRole === "OWNER" : true;
}

// target 取得前の除名資格判定。本人退会は無条件、他者除名は ADMIN 以上。
export function canAttemptRemoval(actorRole: Role, isSelf: boolean): boolean {
  return isSelf || isAtLeast(actorRole, "ADMIN");
}

// target 取得後の OWNER 保護判定。OWNER を他者が抜くのは OWNER のみ。
// 未知の targetRole は保守側 (OWNER 相当) に扱い、ADMIN の任意除名を許さない。
export function canRemoveTarget(actorRole: Role, isSelf: boolean, targetRole: Role): boolean {
  const targetIsOwnerLike = !isKnownRole(targetRole) || targetRole === "OWNER";
  return !(targetIsOwnerLike && !isSelf && actorRole !== "OWNER");
}

// deps に per-request でしか持てないリソース (pg.Pool 実体等) を bind しない。findMembership を
// module ロード時 bind してよいのは RoutingPool が pool 解決を AsyncLocalStorage に委ねるため
// (CLAUDE.md workerd gotcha / PR #91)。
export function createMembershipGuard(deps: {
  getActor: (headers: Headers) => Promise<Actor | null>;
  // findMembership の throw は捕捉せず伝播させ 500 にする (fail-closed の対象は session 解決のみ)。
  // identity DB を RPC 化して findMembership が RPC になる時、auth 断→401 / membership 断→500 の
  // 失敗契約の非対称を再判断する。
  findMembership: typeof findMembership;
}) {
  const requireActor = async (headers: Headers): Promise<ActorResult> => {
    // getActor の失敗 (cookie 不正 / Redis 一時断 / 設定ミス) は null に倒し 401 にする
    // = auth は fail-closed が安全 (誤って通すより拒否する)。fail-closed を組立済み guard の
    // production getActor でなくここで担保し、DI 差し替えの getActor が throw しても 401 に落とす。
    // 呼び出しを .then に包むのは、非 async な getActor の同期 throw も拾うため。直接
    // deps.getActor().catch() だと同期 throw は .catch 装着前に伝播して 500 になり fail-open する。
    const actor = await Promise.resolve()
      .then(() => deps.getActor(headers))
      .catch(() => null);
    if (!actor) return { ok: false, error: "unauthorized", status: 401 };
    return { ok: true, actor };
  };

  // 401→400→403 の status 順序を保つ route が requireActor と別に呼ぶ (401 と 403 の間に body parse 400 を挟むため)。Actor 型を受けることで「認証済み actor しか渡せない」前提を型で表明する。
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
    return { ok: true, membership };
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
    return { ok: true, actor: actorResult.actor, membership: membershipResult.membership };
  };

  return { requireActor, requireMembershipOf, requireMembership };
}

const guard = createMembershipGuard({
  // fail-closed (getSession 失敗時の 401 倒し) は requireActor 側に集約している。
  getActor: async (headers) => {
    const session = await auth.api.getSession({ headers });
    return session?.user?.id ? { id: session.user.id, email: session.user.email } : null;
  },
  findMembership,
});

export const requireActor = guard.requireActor;
export const requireMembershipOf = guard.requireMembershipOf;
export const requireMembership = guard.requireMembership;
