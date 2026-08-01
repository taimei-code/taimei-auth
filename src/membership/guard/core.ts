import { auth } from "../../auth";
import { isAtLeast } from "../policy";
import { findMembership, type Role } from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";

// SPA 向け Hono ルートの認可入口 (I/O 層) のコア。session→membership→role→403 を解決し、
// handler が `if (!r.ok) return guardErrorResponse(r)` の 1 行で HTTP に写像できる Result を返す。
// この 4 ステップが各 route にコピペで散るのを防ぐ。role 判定の純粋述語 (canChangeRole 等) は
// policy.ts に集約。Hono には依存しない。operation 単位 entry (requireRoleChange 等) は同 dir の
// 別 file に置き、この core が共通の generic entry (requireActor / requireMembershipOf /
// requireMembership) と Result 型を提供する。

// lastUsedCompanyId を載せるのは、getActor が fail-closed 判定で user 行を毎 request 読んで
// いるため。列を捨てると handler / use-case が同じ行をもう 1 度 SELECT する羽目になる
// (GET /api/account/memberships は SPA の全 /account ページで呼ばれる最頻 endpoint)。
export type Actor = { id: string; email: string; lastUsedCompanyId: string | null };

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

// operation 単位 entry の parseBody callback 契約。zod schema は Transport 側 (handler) に残し、
// callback が {ok:true, data} | {ok:false, details?} で返す。details は「invalid_argument に details
// を付けて 400 を返す 3 route (signup 作成 / add / 招待作成)」のみ non-undefined、他 route は省略。
export type ParseBodyResult<T> = { ok: true; data: T } | { ok: false; details?: unknown };

export type ParseBodyCallback<T> = () => Promise<ParseBodyResult<T>> | ParseBodyResult<T>;

// parseBody callback を await し、失敗時は InvalidArgument に写像して 1 箇所に閉じる。
// entry 側は `const p = await resolveParseBody(cb); if (!p.ok) return p;` の 2 行で
// 判定順コメントとの 1:1 対応が保てる。
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
// module ロード時 bind してよいのは RoutingPool が pool 解決を AsyncLocalStorage に委ねるため
// (CLAUDE.md workerd gotcha / PR #91)。
export type GuardDeps = {
  getActor: (headers: Headers) => Promise<Actor | null>;
  // findMembership の throw は捕捉せず伝播させ 500 にする (fail-closed の対象は session 解決のみ)。
  // identity DB を RPC 化して findMembership が RPC になる時、auth 断→401 / membership 断→500 の
  // 失敗契約の非対称を再判断する。
  findMembership: typeof findMembership;
};

export function createMembershipGuard(deps: GuardDeps) {
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

// 本番用 default guard。handler / rpc / tests が名前 import で使う。
export const guard: MembershipGuard = createMembershipGuard({
  // fail-closed (getSession 失敗時の 401 倒し) は requireActor 側に集約している。
  getActor: async (headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) return null;
    // better-auth cookieCache (最大 5 分) は user 行の削除後も session を返し続ける。
    // 削除済み user を actor として通すと membership insert 等が FK 違反 500 になるため、
    // VerifySession の USER_DELETED (src/rpc/auth-handler.ts) と同じく DB の user 存在で
    // fail-closed する。DB 断で読めない場合も requireActor の catch が 401 に倒す。
    const dbUser = await findUserById(session.user.id);
    return dbUser
      ? { id: dbUser.id, email: dbUser.email, lastUsedCompanyId: dbUser.lastUsedCompanyId }
      : null;
  },
  findMembership,
});
