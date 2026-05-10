import type { createAuthClient } from "./server";
import { mapConnectError } from "./server";

type AuthClient = ReturnType<typeof createAuthClient>;

type GuardOptions = {
  client: AuthClient;
  cache: <T extends (...args: any[]) => any>(fn: T) => T;
  redirect: (url: string) => never;
  getSessionToken: () => Promise<string | undefined>;
};

// SessionData に IdP 内部表現 (token / userId) を増やしてはならない。詳細: docs/adr/0006-sdk-encapsulation.md
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
    expiresAt: string;
  };
};

export function createAuthGuard(options: GuardOptions) {
  const { client, cache, redirect, getSessionToken } = options;

  const verifySession = cache(async (opts?: { returnTo?: string }): Promise<SessionData> => {
    const token = await getSessionToken();

    if (!token) {
      redirect(`/auth?callbackUrl=${encodeURIComponent(opts?.returnTo ?? "/dashboard")}`);
    }

    // Next.js の redirect() は NEXT_REDIRECT を throw する制御フローのため、try で包むと catch されて
    // リダイレクトが機能しない。RPC 呼び出しのみ try で囲み、redirect は外側で実行する
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
        expiresAt: result.session!.expiresAt,
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
          expiresAt: result.session.expiresAt,
        },
      };
    } catch {
      return null;
    }
  });

  return { verifySession, getSession };
}
