import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { Code } from "@connectrpc/connect";
import { buildSessionCookieHeader } from "@taimei-code/auth-client";
import { Effect } from "effect";
import { AccountRepo, SessionRepo, UserRepo } from "../account/ports";
import { appendAuditLogBestEffort } from "../audit/report-failure";
import { AuthApi } from "../auth-service";
import { Background } from "../background";
import {
  AuthService,
  Result,
  SessionSchema,
  UserSchema,
  VerifySessionErrorSchema,
  VerifySessionOkSchema,
  VerifySessionResponseSchema,
} from "../gen/auth/v1/auth_pb";
import { getClientContext } from "../request-context";
import { toProtoAccount, toProtoSession, toProtoUser, userResponse } from "./mappers";
import { RpcError, runRpc } from "./run-rpc";

const verifySessionError = (reason: Result) =>
  create(VerifySessionResponseSchema, {
    outcome: {
      case: "error",
      value: create(VerifySessionErrorSchema, { reason }),
    },
  });

// session 検証の本体。test が port の test Layer を差し替えて直接走らせられるよう program を分離する
// (auth-entry-redirect.ts と同じ形)。
export const verifySessionProgram = Effect.fn("rpc.verifySession")(function* (req: {
  sessionToken: string;
}) {
  // auth.api.getSession で secondaryStorage (Redis) の payload を取り、user.revision と DB の最新値を
  // 比較する。参照するのは cookieCache でなく Redis 側 payload (handler は cookie を送らないため)。
  const headers = new Headers();
  headers.set("cookie", buildSessionCookieHeader(req.sessionToken));

  const authApi = yield* AuthApi;
  const result = yield* authApi.getSession(headers);

  if (!result?.user || !result?.session) {
    return verifySessionError(Result.SESSION_NOT_FOUND);
  }

  // cookieCache を bypass し DB の最新値を毎回読む。hot path のため 2 つの SELECT を 1 RTT に畳む。
  const users = yield* UserRepo;
  const sessions = yield* SessionRepo;
  const [dbUser, revokedAt] = yield* Effect.all(
    [users.findUserById(result.user.id), sessions.findSessionRevokedAt(result.session.id)],
    { concurrency: "unbounded" },
  );
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
    yield* authApi
      .signOut(headers)
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() => console.warn("signOut failed during revision mismatch", failure.cause)),
        ),
      );
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
});

// 各 method は Effect program を runRpc (Connect 側の唯一の写像点) で走らせる (ADR-0017)。better-auth API は
// すべて AuthApi service 経由 (失敗は AuthApiError = boundary、wire は Code.Unknown + 元 message)。
export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    verifySession: (req) => runRpc(verifySessionProgram(req)),

    getUser: (req) =>
      runRpc(
        UserRepo.use((users) => users.findUserById(req.userId)).pipe(Effect.map(userResponse)),
      ),

    findAccountByUserId: (req) =>
      runRpc(
        AccountRepo.use((accounts) => accounts.findAccountByUserId(req.userId)).pipe(
          Effect.map((row) => ({ account: row ? toProtoAccount(row) : undefined })),
        ),
      ),

    signOut: (req) =>
      runRpc(
        Effect.gen(function* () {
          // auth.api.signOut 経由で Redis cookieCache と DB session を一括 invalidate する。例外は透過させ
          // (defect → runRpc が Internal 化) consumer に正しく伝える。
          const headers = new Headers();
          headers.set("cookie", buildSessionCookieHeader(req.sessionToken));
          // sign-out path は better-auth hooks.after で ctx.context.session が populate されない (1.6.9) ため、
          // signOut 前に session lookup して user_id を取る。IP / userAgent は "unknown" 固定: /rpc/* は consumer
          // backend からの service-to-service 呼び出し (requireServiceKey) で、ctx.requestHeader が持つのは
          // consumer server の identity であって end user のものではない (request-context の信頼 hop 判定も通らない)。
          const authApi = yield* AuthApi;
          const result = yield* authApi.getSession(headers).pipe(Effect.orElseSucceed(() => null));
          const userId = result?.user?.id;
          if (userId) {
            const background = yield* Background;
            const { ip, userAgent } = getClientContext(null);
            yield* background.run(
              appendAuditLogBestEffort({
                eventType: "sign_out",
                userId,
                payload: { ip, userAgent },
              }),
            );
          }
          yield* authApi.signOut(headers);
          return { success: true };
        }),
      ),

    sendMagicLink: (req) =>
      runRpc(
        AuthApi.use((api) =>
          api.signInMagicLink({ email: req.email, callbackURL: req.callbackUrl }),
        ).pipe(
          Effect.mapError(
            (failure) =>
              new RpcError({
                code: Code.Internal,
                message: `Failed to send magic link: ${failure.cause}`,
              }),
          ),
          Effect.as({ success: true }),
        ),
      ),
  });
}
