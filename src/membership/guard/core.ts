import { Effect } from "effect";
import { auth } from "../../auth";
import { Sentry } from "../../sentry";
import { isAtLeast } from "../policy";
import { findMembership, type Role } from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";

// ADR-0012 (Guard 層) / CONTEXT.md「membership guard」: generic entry と Result 型の正本。Hono 非依存。
//
// 案 E1 (Effect v4) prototype: 判定の合成は Effect program (`guard.effect.*`) で書き、失敗は従来の Result 型
// `{ ok: false, ... }` object をそのまま error channel に載せる (respond.ts の catalog と 1:1 を保つ)。
// Transport との境界 (`requireActor` 等) は従来どおり Promise<Result> で、`runGuard` が Effect を Result に
// 写像する。Repository (drizzle) は Promise のまま `Effect.promise` / `Effect.tryPromise` で包む (案 R1)。

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

// 失敗 object は呼び出しごとに生成する (handler 側に渡る object を entry 間で共有しない)。
export const unauthorized = (): Unauthorized => ({ ok: false, error: "unauthorized", status: 401 });
export const forbidden = (): Forbidden => ({ ok: false, error: "forbidden", status: 403 });
export const notFound = (): NotFound => ({ ok: false, error: "not_found", status: 404 });
// details は undefined のとき key 自体を持たせない (guardErrorResponse の `in` 判定と byte-invariant を保つ)。
export const invalidArgument = (details?: unknown): InvalidArgument => {
  const invalid: InvalidArgument = { ok: false, error: "invalid_argument", status: 400 };
  if (details !== undefined) invalid.details = details;
  return invalid;
};

export type ActorResult = { ok: true; actor: Actor } | Unauthorized;

type MembershipOnlyResult = { ok: true; role: Role } | Forbidden;

// operation 単位 entry の parseBody callback 契約。zod schema は Transport 側に残す。details は
// invalid_argument に details を付ける 3 route (signup 作成 / add / 招待作成) のみ non-undefined。
export type ParseBodyResult<T> = { ok: true; data: T } | { ok: false; details?: unknown };

export type ParseBodyCallback<T> = () => Promise<ParseBodyResult<T>> | ParseBodyResult<T>;

// Effect<A, E> を Transport 向けの Result (A | E) に写像して実行する。defect (findMembership 等の throw) は
// error channel に乗らず、runPromise が Cause を squash して元の Error のまま reject するため、従来どおり
// handler の onError → 500 に伝播する (QA-R-05)。
export const runGuard = <A, E>(program: Effect.Effect<A, E>): Promise<A | E> =>
  Effect.runPromise(Effect.match(program, { onFailure: (e) => e, onSuccess: (a) => a }));

// parseBody callback の throw は捕捉しない (従来の await と同じく defect として 500 に伝播)。
export const parseBody = <T>(parse: ParseBodyCallback<T>): Effect.Effect<T, InvalidArgument> =>
  Effect.promise(async () => parse()).pipe(
    Effect.flatMap((parsed) =>
      parsed.ok ? Effect.succeed(parsed.data) : Effect.fail(invalidArgument(parsed.details)),
    ),
  );

export async function resolveParseBody<T>(
  parse: ParseBodyCallback<T>,
): Promise<{ ok: true; data: T } | InvalidArgument> {
  return runGuard(Effect.map(parseBody(parse), (data) => ({ ok: true as const, data })));
}

// target 側 membership の取得。不在は NotFound として error channel に載せる (null → 404 写像の正本)。
// findMembership の throw は Effect.promise が defect にするため伝播し 500 になる (QA-R-05)。
export const requireTargetMembership = (
  find: typeof findMembership,
  userId: string,
  companyId: string,
) =>
  Effect.promise(() => find(userId, companyId)).pipe(
    Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.fail(notFound()))),
  );

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
  // getActor の失敗は null に倒し 401 にする (auth は fail-closed)。Effect.tryPromise は thunk の同期 throw と
  // reject の両方を error channel に載せるため、旧 `Promise.resolve().then(...).catch(...)` と同じ範囲を拾う。
  // 障害と未認証が同じ 401 になるため、障害側は Sentry に残す。
  const requireActor = (headers: Headers): Effect.Effect<Actor, Unauthorized> =>
    Effect.tryPromise({ try: () => deps.getActor(headers), catch: (error) => error }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          Sentry.captureException(error, { tags: { component: "membership-guard" } });
          return null;
        }),
      ),
      Effect.flatMap((actor) => (actor ? Effect.succeed(actor) : Effect.fail(unauthorized()))),
    );

  // 401→400→403 の順序を保つ route が requireActor と別に呼ぶ (401 と 403 の間に body parse 400 を挟む)。
  const requireMembershipOf = (
    actor: Actor,
    companyId: string,
    minRole?: Role,
  ): Effect.Effect<Role, Forbidden> =>
    Effect.promise(() => deps.findMembership(actor.id, companyId)).pipe(
      Effect.flatMap((membership) => {
        if (!membership) return Effect.fail(forbidden());
        // 未知 role は fail-closed で 403 に倒す (isAtLeast が own-property 判定で未知 role を false に落とす)。
        if (minRole && !isAtLeast(membership.role, minRole)) return Effect.fail(forbidden());
        return Effect.succeed(membership.role);
      }),
    );

  const requireMembership = (
    headers: Headers,
    companyId: string,
    minRole?: Role,
  ): Effect.Effect<{ actor: Actor; role: Role }, Unauthorized | Forbidden> =>
    Effect.gen(function* () {
      const actor = yield* requireActor(headers);
      const role = yield* requireMembershipOf(actor, companyId, minRole);
      return { actor, role };
    });

  return {
    // Transport 向け Promise<Result> 境界 (既存契約。handler は `if (!r.ok) return guardErrorResponse(r)`)。
    requireActor: (headers: Headers): Promise<ActorResult> =>
      runGuard(Effect.map(requireActor(headers), (actor) => ({ ok: true as const, actor }))),
    requireMembershipOf: (
      actor: Actor,
      companyId: string,
      minRole?: Role,
    ): Promise<MembershipOnlyResult> =>
      runGuard(
        Effect.map(requireMembershipOf(actor, companyId, minRole), (role) => ({
          ok: true as const,
          role,
        })),
      ),
    requireMembership: (
      headers: Headers,
      companyId: string,
      minRole?: Role,
    ): Promise<MembershipGuardResult> =>
      runGuard(
        Effect.map(requireMembership(headers, companyId, minRole), (r) => ({
          ok: true as const,
          ...r,
        })),
      ),
    // operation 単位 entry が Effect program のまま合成するための入口 (Promise を挟まない)。
    effect: { requireActor, requireMembershipOf, requireMembership },
  };
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
