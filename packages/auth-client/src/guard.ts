import type { createAuthClient } from "./server";
import type { SessionData, VerifyResult } from "./types";
import { Result } from "./gen/auth/v1/auth_pb";

type AuthClient = ReturnType<typeof createAuthClient>;

// React.cache 互換シグネチャを `any` を使わず Args/R の dual generic で表現する。
type CacheFn = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
) => (...args: Args) => R;

type GuardOptions = {
  client: AuthClient;
  getSessionToken: () => Promise<string | undefined>;
  // Next.js consumer は React.cache を注入することで 1 request 内 dedup を得る。
  // 省略時は dedup 無し。Hono / Express 等で同 request 内多重呼出する場合は consumer 側で
  // memoize するか cache を注入する。
  cache?: CacheFn;
};

// ExternalToken / InternalSession brand 型は本 module 内に閉じる。
// declare const symbol は dist/guard.d.ts に登場しないため consumer に漏出しない。
declare const externalTokenBrand: unique symbol;
declare const internalSessionBrand: unique symbol;

type ExternalToken = { readonly raw: string; readonly [externalTokenBrand]: true };
type InternalSession = SessionData & { readonly [internalSessionBrand]: true };

const identity: CacheFn = (fn) => fn;

const asExternalToken = (raw: string): ExternalToken => ({ raw }) as ExternalToken;
const asInternalSession = (data: SessionData): InternalSession => data as InternalSession;

export function createAuthGuard(options: GuardOptions) {
  const { client, getSessionToken, cache = identity } = options;

  // 戻り値は VerifyResult。consumer は `result.ok` で分岐する。
  // RPC エラー (transport down 等) は Result.UNSPECIFIED を返し、consumer は再ログインに倒す。
  const getSession = cache(async (): Promise<VerifyResult> => {
    const raw = await getSessionToken();
    if (!raw) {
      return { ok: false, reason: Result.SESSION_NOT_FOUND };
    }
    const token: ExternalToken = asExternalToken(raw);

    // verifyResponse: RPC からの raw proto レスポンス。外側関数の戻り値型 `VerifyResult` と
    // 名前が衝突しないよう response を用いる (brand 内部実装の可読性)。
    const verifyResponse = await client.authService
      .verifySession({ sessionToken: token.raw })
      .catch(() => null);

    if (!verifyResponse) {
      return { ok: false, reason: Result.UNSPECIFIED };
    }

    // proto-es oneof は case: "ok" | "error" | undefined。default 経路は
    // 「outcome 想定外」fallback (consumer は再ログインに倒す単一 fallback)。
    switch (verifyResponse.outcome.case) {
      case "error":
        return { ok: false, reason: verifyResponse.outcome.value.reason };
      case "ok": {
        const { user, session } = verifyResponse.outcome.value;
        if (!user || !session) {
          return { ok: false, reason: Result.UNSPECIFIED };
        }
        // brand 型で internal-only な session 表現を作る。consumer には plain SessionData として返す。
        const internal: InternalSession = asInternalSession({
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          session: {
            id: session.id,
            expiresAt: session.expiresAt,
            kind: "user",
          },
          // ADR-009: Phase A の companyId source は user.default_company_id (= last_used_company_id)。
          // session.company_id は Phase C の事業所切替で使う想定だが、secondaryStorage 構成では
          // session が Redis 管理で DB 列が空のため、Phase A では user 側の永続値を権威とする。
          // undefined は consumer 側で「事業所未選択」(/auth/signup/company へ redirect) として扱う。
          companyId: session.companyId ?? user.defaultCompanyId,
        });
        return { ok: true, data: internal };
      }
      default:
        return { ok: false, reason: Result.UNSPECIFIED };
    }
  });

  return { getSession };
}
