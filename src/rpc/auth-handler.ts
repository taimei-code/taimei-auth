import type { ConnectRouter } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { buildSessionCookieHeader } from "@taimei-code/auth-client";
import {
  AuthService,
  Result,
  SessionSchema,
  UserSchema,
  VerifySessionErrorSchema,
  VerifySessionOkSchema,
  VerifySessionResponseSchema,
} from "../gen/auth/v1/auth_pb";
import { auth } from "../auth";
import { findAccountByUserId as findAccountByUserIdRepo } from "@/db/repositories/account";
import { appendAuditLog } from "@/db/repositories/audit-log";
import { findSessionRevokedAt } from "@/db/repositories/session";
import { findUserById as findUserByIdRepo } from "@/db/repositories/user";
import { captureAuditLogError } from "../audit-error";
import { toProtoAccount, toProtoSession, toProtoUser } from "./mappers";

const verifySessionError = (reason: Result) =>
  create(VerifySessionResponseSchema, {
    outcome: {
      case: "error",
      value: create(VerifySessionErrorSchema, { reason }),
    },
  });

export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    async verifySession(req) {
      // auth.api.getSession で secondaryStorage (Redis) の payload を取り、user.revision と DB の最新値を
      // 比較する。参照するのは cookieCache でなく Redis 側 payload (handler は cookie を送らないため)。
      const headers = new Headers();
      headers.set("cookie", buildSessionCookieHeader(req.sessionToken));

      const result = await auth.api.getSession({ headers });

      if (!result?.user || !result?.session) {
        return verifySessionError(Result.SESSION_NOT_FOUND);
      }

      // cookieCache を bypass し DB の最新値を毎回読む。hot path のため 2 つの SELECT を 1 RTT に畳む。
      const [dbUser, revokedAt] = await Promise.all([
        findUserByIdRepo(result.user.id),
        findSessionRevokedAt(result.session.id),
      ]);
      if (!dbUser) {
        return verifySessionError(Result.USER_DELETED);
      }
      if (revokedAt !== null) {
        return verifySessionError(Result.REVOKED);
      }

      // revision 導入前に発行された Redis session payload にはフィールドが無いため optional で読む。
      // undefined は cache miss として整合判定を skip し一斉ログアウト loop を防ぐ (失効で自然消滅)。
      const cachedRevision: number | undefined = result.user.revision;
      if (cachedRevision !== undefined && dbUser.revision !== cachedRevision) {
        // signOut 例外は握り必ず REVISION_OUTDATED を返す (consumer は再ログインに倒すため)。
        await auth.api
          .signOut({ headers })
          .catch((e) => console.warn("signOut failed during revision mismatch", e));
        return verifySessionError(Result.REVISION_OUTDATED);
      }

      return create(VerifySessionResponseSchema, {
        outcome: {
          case: "ok",
          value: create(VerifySessionOkSchema, {
            user: create(UserSchema, toProtoUser(dbUser)),
            session: create(SessionSchema, toProtoSession(result.session)),
          }),
        },
      });
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
      // auth.api.signOut 経由で Redis cookieCache と DB session を一括 invalidate する。例外は透過させ
      // ConnectRPC adapter の Code.Unknown 化に委ねる方が consumer に正しく伝わる。
      const headers = new Headers();
      headers.set("cookie", buildSessionCookieHeader(req.sessionToken));
      // sign-out path は better-auth hooks.after で ctx.context.session が populate されない (1.6.9) ため、
      // signOut 前に session lookup して user_id を取る。IP / userAgent は RPC 経由で取れず "unknown" 固定。
      const result = await auth.api.getSession({ headers }).catch(() => null);
      const userId = result?.user?.id;
      if (userId) {
        appendAuditLog({
          eventType: "sign_out",
          userId,
          payload: { ip: "unknown", userAgent: "unknown" },
        }).catch((e) => captureAuditLogError("sign_out", e));
      }
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
