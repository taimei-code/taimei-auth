import type { createAuthClient } from "./server";
import type { SessionData } from "./types";

type AuthClient = ReturnType<typeof createAuthClient>;

// React.cache 互換シグネチャを `any` を使わず Args/R の dual generic で表現する。
type CacheFn = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
) => (...args: Args) => R;

type GuardOptions = {
  client: AuthClient;
  getSessionToken: () => Promise<string | undefined>;
  // Next.js consumer は React.cache を注入することで 1 request 内 dedup を得る。
  // 省略時は dedup 無し: 1 request 内で getSession() を N 回呼ぶと verifySession が N 回発火する。
  // Hono / Express 等で同 request 内多重呼出する場合は consumer 側で memoize するか cache を注入する。
  cache?: CacheFn;
};

// proto レスポンスの shape subset。proto 型を直接 import すると hard couple するため、
// SDK 内部で必要な user / session フィールドを SessionData 形状で部分的に表現する。
type VerifySessionResult = {
  user?: SessionData["user"];
  session?: SessionData["session"];
};

const identity: CacheFn = (fn) => fn;

export function createAuthGuard(options: GuardOptions) {
  const { client, getSessionToken, cache = identity } = options;

  // 失敗 (token 不在 / RPC エラー / user/session 欠落) を null に統一することで consumer 側は単一の null 分岐で済む。
  // 「未ログイン」と「IdP ダウン」を区別したい consumer は raw `client.authService` + `mapConnectError` を使うこと。
  // redirect 等の framework 固有制御フローは consumer 側 wrapper に委ね、SDK は副作用を持たない (ADR-007)。
  const getSession = cache(async (): Promise<SessionData | null> => {
    const token = await getSessionToken();
    if (!token) return null;

    const verifyResult: VerifySessionResult | null = await client.authService
      .verifySession({ sessionToken: token })
      .catch(() => null);

    if (!verifyResult) return null;

    const { user, session } = verifyResult;
    if (!user || !session) return null;

    return { user, session };
  });

  return { getSession };
}
