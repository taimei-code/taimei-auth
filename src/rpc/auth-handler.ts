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
      const result = await db
        .select()
        .from(session)
        .where(eq(session.token, req.sessionToken))
        .then((rows) => rows.at(0));

      if (!result || new Date(result.expiresAt) < new Date()) {
        return { user: undefined, session: undefined };
      }

      const userResult = await db
        .select()
        .from(user)
        .where(eq(user.id, result.userId))
        .then((rows) => rows.at(0));

      if (!userResult) {
        return { user: undefined, session: undefined };
      }

      return {
        user: {
          id: userResult.id,
          name: userResult.name,
          email: userResult.email,
          emailVerified: userResult.emailVerified,
          image: userResult.image ?? undefined,
          createdAt: userResult.createdAt.toISOString(),
          updatedAt: userResult.updatedAt.toISOString(),
        },
        session: {
          id: result.id,
          token: result.token,
          expiresAt: result.expiresAt.toISOString(),
          userId: result.userId,
          ipAddress: result.ipAddress ?? undefined,
          userAgent: result.userAgent ?? undefined,
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
