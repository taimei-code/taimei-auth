import type { createAuthClient } from "./server";
import type { SessionData, VerifyResult } from "./types";
import { Result, type VerifySessionResponse } from "./gen/auth/v1/auth_pb";

type AuthClient = ReturnType<typeof createAuthClient>;

// react を import せず React.cache をそのまま注入できる形。詳細: packages/auth-client/CLAUDE.md ルール 7 (層 1)
type CacheFn = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
) => (...args: Args) => R;

type GuardOptions = {
  client: AuthClient;
  getSessionToken: () => Promise<string | undefined>;
  // 1 request 内の多重呼出を dedup する memoize 関数 (Next.js consumer は React.cache を渡す)。
  // 省略時は dedup 無しで毎回 VerifySession RPC が飛ぶ。
  cache?: CacheFn;
};

// brand 型は本 module 内に閉じる: `declare const` の unique symbol は dist/guard.d.ts に出力されず
// consumer に漏出しない (回帰は __tests__/verify-result.test.ts で検出する)。
declare const externalTokenBrand: unique symbol;
declare const internalSessionBrand: unique symbol;

type ExternalToken = { readonly raw: string; readonly [externalTokenBrand]: true };
type InternalSession = SessionData & { readonly [internalSessionBrand]: true };

const identity: CacheFn = (fn) => fn;

const asExternalToken = (raw: string): ExternalToken => ({ raw }) as ExternalToken;
const asInternalSession = (data: SessionData): InternalSession => data as InternalSession;

// proto-es の oneof case は "ok" | "error" | undefined。case 欠損と user / session 欠損は
// Result.UNSPECIFIED に倒す (fail-closed)。
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
        // session.companyId は事業所切替 (ADR-009 Phase C) 用で、secondaryStorage 構成では
        // session が Redis 管理のため常に空。現状は user 側の永続値 (last_used_company_id) が権威。
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

  // RPC 失敗 (transport down 等) も Result.UNSPECIFIED を返す。consumer は UNSPECIFIED を再ログインに倒す。
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
