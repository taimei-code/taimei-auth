import type { ConnectRouter } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { buildSessionCookieHeader } from "@taimei-code/auth-client";
import { AuthService } from "../gen/auth/v1/auth_pb";
import { auth } from "../auth";
import { findAccountByUserId as findAccountByUserIdRepo } from "@/db/repositories/account";
import { findUserById as findUserByIdRepo } from "@/db/repositories/user";
import { toProtoAccount, toProtoUser } from "./mappers";

export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    async verifySession(req) {
      // better-auth.api.getSession 経由で Redis cookieCache (auth.ts:106 maxAge 5 分) を温存する (token 直引きは cache bypass)。
      // 戻り型 (image: string | null | undefined) は drizzle row (image: string | null) と微妙にずれるため mappers.ts は流用不可。
      const headers = new Headers();
      headers.set("cookie", buildSessionCookieHeader(req.sessionToken));

      const result = await auth.api.getSession({ headers });

      if (!result?.user || !result?.session) {
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
          expiresAt: new Date(result.session.expiresAt).toISOString(),
        },
      };
    },

    async getUser(req) {
      const row = await findUserByIdRepo(req.userId);
      if (!row) return { user: undefined };
      return { user: toProtoUser(row) };
    },

    async findAccountByUserId(req) {
      const row = await findAccountByUserIdRepo(req.userId);
      if (!row) return { account: undefined };
      return { account: toProtoAccount(row) };
    },

    async signOut(req) {
      // auth.api.signOut 経由で Redis cookieCache (auth.ts:106) と DB session を一括 invalidate する。
      // repository 直叩きで DB だけ消すと cache 5 分の窓で session が valid に見える期間が生じる。
      // better-auth は session 不在 / DB delete 失敗を内部で吸収して常に { success: true } を返すため、
      // ここで catch すると意図しない例外 (signature mismatch / rate limit 等) も握り潰す。
      // 透過させて ConnectRPC adapter に Code.Unknown 化を委譲する方が consumer に正しく伝わる。
      const headers = new Headers();
      headers.set("cookie", buildSessionCookieHeader(req.sessionToken));
      await auth.api.signOut({ headers });
      return { success: true };
    },

    async sendMagicLink(req) {
      await auth.api
        .signInMagicLink({
          body: { email: req.email, callbackURL: req.callbackUrl },
          headers: new Headers(),
        })
        .catch((error) => {
          throw new ConnectError(`Failed to send magic link: ${error}`, Code.Internal);
        });
      return { success: true };
    },
  });
}
