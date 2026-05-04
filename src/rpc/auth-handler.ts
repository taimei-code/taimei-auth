import type { ConnectRouter } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import { AuthService } from "../gen/auth/v1/auth_pb";
import { db } from "@/db/client";
import { user, session, account, verification } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "../auth";

export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    async verifySession(req) {
      // Better Auth は secondaryStorage(Redis) と DB を内部で使い分けるため、
      // db を直接クエリせず auth.api.getSession を経由する必要がある。
      // sessionToken を Cookie ヘッダ形式で渡して Better Auth に委譲する。
      const headers = new Headers();
      headers.set(
        "cookie",
        `better-auth.session_token=${req.sessionToken}; __Secure-better-auth.session_token=${req.sessionToken}`
      );

      const result = await auth.api.getSession({ headers });

      if (!result || !result.user || !result.session) {
        return { user: undefined, session: undefined };
      }

      return {
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          emailVerified: result.user.emailVerified,
          image: result.user.image ?? undefined,
          createdAt: new Date(result.user.createdAt).toISOString(),
          updatedAt: new Date(result.user.updatedAt).toISOString(),
        },
        session: {
          id: result.session.id,
          token: result.session.token,
          expiresAt: new Date(result.session.expiresAt).toISOString(),
          userId: result.session.userId,
          ipAddress: result.session.ipAddress ?? undefined,
          userAgent: result.session.userAgent ?? undefined,
        },
      };
    },

    async getUser(req) {
      const result = await db
        .select()
        .from(user)
        .where(eq(user.id, req.userId))
        .then((rows) => rows.at(0));

      if (!result) {
        return { user: undefined };
      }

      return {
        user: {
          id: result.id,
          name: result.name,
          email: result.email,
          emailVerified: result.emailVerified,
          image: result.image ?? undefined,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        },
      };
    },

    async findAccountByUserId(req) {
      const result = await db
        .select()
        .from(account)
        .where(eq(account.userId, req.userId))
        .then((rows) => rows.at(0));

      if (!result) {
        return { account: undefined };
      }

      return {
        account: {
          id: result.id,
          accountId: result.accountId,
          providerId: result.providerId,
          userId: result.userId,
          accessToken: result.accessToken ?? undefined,
          refreshToken: result.refreshToken ?? undefined,
          scope: result.scope ?? undefined,
        },
      };
    },

    async signOut(req) {
      const result = await db
        .delete(session)
        .where(eq(session.token, req.sessionToken))
        .returning();

      return { success: result.length > 0 };
    },

    async sendMagicLink(req) {
      try {
        await auth.api.signInMagicLink({
          body: { email: req.email, callbackURL: req.callbackUrl },
          headers: new Headers(),
        });
        return { success: true };
      } catch (e) {
        throw new ConnectError(
          `Failed to send magic link: ${e}`,
          Code.Internal
        );
      }
    },
  });
}
