/**
 * Next.js 用セッション検証ヘルパー
 *
 * 使用例:
 *   import { createAuthGuard } from "@taimei-code/auth-client/guard";
 *   const { verifySession, getSession } = createAuthGuard({ ... });
 *
 * Next.js の cache() と redirect() を外部注入することで、
 * このモジュール自体は Next.js に直接依存しない。
 */

import type { createAuthClient } from "./server";
import { mapConnectError } from "./server";

type AuthClient = ReturnType<typeof createAuthClient>;

type GuardOptions = {
  client: AuthClient;
  cache: <T extends (...args: any[]) => any>(fn: T) => T;
  redirect: (url: string) => never;
  getSessionToken: () => Promise<string | undefined>;
};

type SessionData = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
    createdAt: string;
    updatedAt: string;
  };
  session: {
    id: string;
    token: string;
    expiresAt: string;
    userId: string;
  };
};

export function createAuthGuard(options: GuardOptions) {
  const { client, cache, redirect, getSessionToken } = options;

  const verifySession = cache(async (opts?: { returnTo?: string }): Promise<SessionData> => {
    const token = await getSessionToken();

    if (!token) {
      redirect(`/auth?callbackUrl=${encodeURIComponent(opts?.returnTo ?? "/dashboard")}`);
    }

    // Next.js の redirect() は NEXT_REDIRECT を throw する制御フロー実装のため、
    // try/catch で囲むと catch 句に NEXT_REDIRECT が捕捉されてリダイレクトが機能しない。
    // RPC 呼び出しのみを try で囲み、redirect は外側で実行する。
    let result;
    try {
      result = await client.authService.verifySession({
        sessionToken: token!,
      });
    } catch (error) {
      throw mapConnectError(error);
    }

    if (!result.user || !result.session) {
      redirect(`/auth?callbackUrl=${encodeURIComponent(opts?.returnTo ?? "/dashboard")}`);
    }

    return {
      user: {
        id: result.user!.id,
        name: result.user!.name,
        email: result.user!.email,
        emailVerified: result.user!.emailVerified,
        image: result.user!.image,
        createdAt: result.user!.createdAt,
        updatedAt: result.user!.updatedAt,
      },
      session: {
        id: result.session!.id,
        token: result.session!.token,
        expiresAt: result.session!.expiresAt,
        userId: result.session!.userId,
      },
    };
  });

  const getSession = cache(async (): Promise<SessionData | null> => {
    const token = await getSessionToken();

    if (!token) return null;

    try {
      const result = await client.authService.verifySession({
        sessionToken: token!,
      });

      if (!result.user || !result.session) return null;

      return {
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          emailVerified: result.user.emailVerified,
          image: result.user.image,
          createdAt: result.user.createdAt,
          updatedAt: result.user.updatedAt,
        },
        session: {
          id: result.session.id,
          token: result.session.token,
          expiresAt: result.session.expiresAt,
          userId: result.session.userId,
        },
      };
    } catch {
      return null;
    }
  });

  return { verifySession, getSession };
}
