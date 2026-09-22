import type { createAuthClient } from "./server";
import type { SessionData, VerifyResult } from "./types";
import { Result, type VerifySessionResponse } from "./gen/auth/v1/auth_pb";

type AuthClient = ReturnType<typeof createAuthClient>;

// React.cache をそのまま渡せる形 (react は import しない)。
type CacheFn = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
) => (...args: Args) => R;

type GuardOptions = {
  client: AuthClient;
  getSessionToken: () => Promise<string | undefined>;
  // 1 request 内の重複呼び出しをまとめる (Next.js では React.cache)。省略時は毎回 RPC。
  cache?: CacheFn;
};

// declare const の unique symbol は dist/guard.d.ts に出ず consumer に漏れない。
declare const externalTokenBrand: unique symbol;
declare const internalSessionBrand: unique symbol;

type ExternalToken = { readonly raw: string; readonly [externalTokenBrand]: true };
type InternalSession = SessionData & { readonly [internalSessionBrand]: true };

const identity: CacheFn = (fn) => fn;

const asExternalToken = (raw: string): ExternalToken => ({ raw }) as ExternalToken;
const asInternalSession = (data: SessionData): InternalSession => data as InternalSession;

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
        // secondaryStorage 構成では session.companyId は常に空なので user.defaultCompanyId (last_used_company_id) を正とする。
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
