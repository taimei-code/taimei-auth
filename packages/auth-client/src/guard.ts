import type { createAuthClient } from "./server";
import type { SessionData, VerifyResult } from "./types";
import { Result, type VerifySessionResponse } from "./gen/auth/v1/auth_pb";

type AuthClient = ReturnType<typeof createAuthClient>;

// react を import せずに React.cache をそのまま注入できる形にする。詳細は packages/auth-client/CLAUDE.md ルール 7 (層 1) を参照
type CacheFn = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
) => (...args: Args) => R;

type GuardOptions = {
  client: AuthClient;
  getSessionToken: () => Promise<string | undefined>;
  // 1 request の中で重複する呼び出しをまとめる memoize (Next.js の consumer では React.cache)。省略すると毎回 RPC を呼ぶ。
  cache?: CacheFn;
};

// brand 型はこの module の中に閉じる。`declare const` の unique symbol は dist/guard.d.ts に出力されず、
// consumer に漏れない (退行は __tests__/verify-result.test.ts で検出する)。
declare const externalTokenBrand: unique symbol;
declare const internalSessionBrand: unique symbol;

type ExternalToken = { readonly raw: string; readonly [externalTokenBrand]: true };
type InternalSession = SessionData & { readonly [internalSessionBrand]: true };

const identity: CacheFn = (fn) => fn;

const asExternalToken = (raw: string): ExternalToken => ({ raw }) as ExternalToken;
const asInternalSession = (data: SessionData): InternalSession => data as InternalSession;

// case が無い場合と user または session が無い場合は Result.UNSPECIFIED として扱う (fail-closed)。
const toVerifyResult = (response: VerifySessionResponse): VerifyResult => {
  switch (response.outcome.case) {
    case "error":
      return { ok: false, reason: response.outcome.value.reason };
    case "ok": {
      const { user, session } = response.outcome.value;
      if (!user || !session) {
        return { ok: false, reason: Result.UNSPECIFIED };
      }
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
        // session.companyId は事業所切替 (PR #55 から #63) のための値で、secondaryStorage 構成では
        // session を TTL store が管理するため常に空になる。現状は user 側の永続値 (last_used_company_id) を正とする。
        companyId: session.companyId ?? user.defaultCompanyId,
      });
      return { ok: true, data: internal };
    }
    default:
      return { ok: false, reason: Result.UNSPECIFIED };
  }
};

export function createAuthGuard(options: GuardOptions) {
  const { client, getSessionToken, cache = identity } = options;

  // RPC の失敗 (transport が落ちている場合など) でも Result.UNSPECIFIED を返す。consumer は UNSPECIFIED を再ログインとして扱う。
  const getSession = cache(async (): Promise<VerifyResult> => {
    const raw = await getSessionToken();
    if (!raw) {
      return { ok: false, reason: Result.SESSION_NOT_FOUND };
    }
    const token: ExternalToken = asExternalToken(raw);

    const response = await client.authService
      .verifySession({ sessionToken: token.raw })
      .catch(() => null);
    if (!response) {
      return { ok: false, reason: Result.UNSPECIFIED };
    }

    return toVerifyResult(response);
  });

  return { getSession };
}
