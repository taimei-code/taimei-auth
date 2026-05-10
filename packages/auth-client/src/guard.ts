import type { createAuthClient } from "./server";
import { mapConnectError } from "./server";
import type { SessionData } from "./types";

type AuthClient = ReturnType<typeof createAuthClient>;

// React.cache 互換シグネチャを `any` を使わず Args/R の dual generic で表現する。
type CacheFn = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
) => (...args: Args) => R;

type GuardOptions = {
  client: AuthClient;
  cache: CacheFn;
  redirect: (url: string) => never;
  getSessionToken: () => Promise<string | undefined>;
};

// proto レスポンスの shape subset。proto 型を直接 import すると hard couple するため、
// SDK 内部で必要な user / session フィールドを SessionData 形状で部分的に表現する。
type VerifySessionResult = {
  user?: SessionData["user"];
  session?: SessionData["session"];
};

// SessionData に乗らないフィールド (token / userId 等) を allowlist 的に切り捨てて
// IdP 内部表現の漏洩を防ぐ。新フィールド追加は SessionData 型と同時にここを更新する責務分担。
function mapToSessionData(input: {
  user: SessionData["user"];
  session: SessionData["session"];
}): SessionData {
  return {
    user: {
      id: input.user.id,
      name: input.user.name,
      email: input.user.email,
      emailVerified: input.user.emailVerified,
      image: input.user.image,
      createdAt: input.user.createdAt,
      updatedAt: input.user.updatedAt,
    },
    session: {
      id: input.session.id,
      expiresAt: input.session.expiresAt,
    },
  };
}

function buildLoginRedirectPath(returnTo: string): string {
  return `/auth?callbackUrl=${encodeURIComponent(returnTo)}`;
}

export function createAuthGuard(options: GuardOptions) {
  const { client, cache, redirect, getSessionToken } = options;

  // requireSession / getSession の共通パイプライン。token 不在 / RPC 失敗 / user/session 欠落を
  // すべて null に正規化し、policy (redirect か null か) を呼び出し側に委ねる。
  // onRpcError は RPC 失敗時の振る舞い切替: requireSession は throw、getSession は null 返し。
  const loadSession = async (onRpcError: (error: unknown) => null): Promise<SessionData | null> => {
    const token = await getSessionToken();
    if (!token) return null;

    // RPC 呼び出しのみ .catch() chain で wrap し、redirect 制御フロー (NEXT_REDIRECT throw) と分離する。
    const verifyResult: VerifySessionResult | null = await client.authService
      .verifySession({ sessionToken: token })
      .catch(onRpcError);

    if (!verifyResult) return null;

    // local 変数に destructure してから narrow する。プロパティアクセス narrowing は中間関数呼び出しで
    // invalidated される TS の制約があるため。
    const { user, session } = verifyResult;
    if (!user || !session) return null;

    return mapToSessionData({ user, session });
  };

  // requireSession: session 不在なら redirect で「以降の処理を中断」する強制版。
  // returnTo は consumer ごとに既定値が異なる (taimei は /dashboard、admin app は別) ため SDK では
  // 必須引数とし、consumer 側 wrap 関数で既定値を注入する責務分割を取る。
  const requireSession = cache(async (opts: { returnTo: string }): Promise<SessionData> => {
    const session = await loadSession((error) => {
      throw mapConnectError(error);
    });

    // session 不在時は redirect で制御を切る。`return redirect(...)` で `Promise<never>` となり
    // `Promise<SessionData>` に assignable (bottom type の性質)。これをしないと後続の narrow が効かない。
    if (!session) {
      return redirect(buildLoginRedirectPath(opts.returnTo));
    }

    return session;
  });

  // getSession: layout/page で「ログイン状態に応じた分岐」用 (requireSession の non-throwing 対)。
  const getSession = cache((): Promise<SessionData | null> => loadSession(() => null));

  return { requireSession, getSession };
}
