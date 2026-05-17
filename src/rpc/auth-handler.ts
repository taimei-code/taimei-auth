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
import { findSessionRevokedAt } from "@/db/repositories/session";
import { findUserById as findUserByIdRepo } from "@/db/repositories/user";
import { toProtoAccount, toProtoSession, toProtoUser } from "./mappers";

const buildError = (reason: Result) =>
  create(VerifySessionResponseSchema, {
    outcome: {
      case: "error",
      value: create(VerifySessionErrorSchema, { reason }),
    },
  });

export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    async verifySession(req) {
      // auth.api.getSession 経由で secondaryStorage (Redis) の payload を取得し、
      // 含まれる user.revision と DB の最新値を比較する。
      // 注意: ここで参照する "cache" は cookieCache (cookie-side payload) ではなく
      // secondaryStorage (Redis 側 payload) — handler は session_data cookie を送らないため
      // internalAdapter.findSession 経由で Redis を引く。
      const headers = new Headers();
      headers.set("cookie", buildSessionCookieHeader(req.sessionToken));

      const result = await auth.api.getSession({ headers });

      if (!result?.user || !result?.session) {
        return buildError(Result.SESSION_NOT_FOUND);
      }

      // VerifySession は cookieCache を bypass し DB の最新値を毎回読む (cookieCache stale 対策)。
      // hot path のため user / session.revoked_at の 2 つの SELECT を Promise.all で 1 RTT に。
      const [dbUser, revokedAt] = await Promise.all([
        findUserByIdRepo(result.user.id),
        findSessionRevokedAt(result.session.id),
      ]);
      if (!dbUser) {
        return buildError(Result.USER_DELETED);
      }
      if (revokedAt && revokedAt <= new Date()) {
        return buildError(Result.REVOKED);
      }

      // 本 migration の初回 deploy 瞬間、Redis 上の既存 session は revision フィールドを持たない。
      // undefined を「cache miss」として扱い整合判定を skip することで、一斉ログアウト loop を防ぐ。
      // 次回 session 発行時に additionalFields 経由で revision が cache に乗るため、
      // この経路は最大でも session.expiresAt 経過で自然消滅する。
      // better-auth additionalFields.revision (auth.ts) で Session 型に revision: number が
      // 自動付与されている。Redis 上の legacy session (PR-A デプロイ前発行) は payload に
      // revision フィールド自体が存在しないため、optional として読む。
      const cachedRevision: number | undefined = result.user.revision;
      if (cachedRevision !== undefined && dbUser.revision !== cachedRevision) {
        // signOut 例外 (Redis 一時断 / signature mismatch 等) は握り、必ず REVISION_OUTDATED を返す。
        // consumer は再ログインに倒すので、ここで ConnectError を伝播させると UX が悪化する。
        await auth.api
          .signOut({ headers })
          .catch((e) => console.warn("signOut failed during revision mismatch", e));
        return buildError(Result.REVISION_OUTDATED);
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
