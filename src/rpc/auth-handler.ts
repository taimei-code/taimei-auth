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
import { captureCause, captureCauseAs } from "../sentry";
import { toProtoAccount, toProtoSession, toProtoUser, userResponse } from "./mappers";
import { RpcError, runRpc } from "./run-rpc";

const verifySessionError = (reason: Result) =>
  create(VerifySessionResponseSchema, {
    outcome: {
      case: "error",
      value: create(VerifySessionErrorSchema, { reason }),
    },
  });

const sessionCookieHeaders = (sessionToken: string) =>
  new Headers({ cookie: buildSessionCookieHeader(sessionToken) });

export const verifySessionProgram = Effect.fn("rpc.verifySession")(function* (req: {
  sessionToken: string;
}) {
  // 参照するのは cookieCache ではなく TTL store 側の payload (handler は cookie を送らないため)。
  const headers = sessionCookieHeaders(req.sessionToken);
  const authApi = yield* AuthApi;
  const result = yield* authApi.getSession(headers);

  if (!result?.user || !result?.session) {
    return verifySessionError(Result.SESSION_NOT_FOUND);
  }

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

  // revision 導入前の payload はこの field を持たない。undefined なら判定を skip し、一斉ログアウトの loop を防ぐ。
  const cachedRevision: number | undefined = result.user.revision;
  if (cachedRevision !== undefined && dbUser.revision !== cachedRevision) {
    yield* authApi
      .signOut(headers)
      .pipe(Effect.catch(captureCause({ tags: { handler: "verifySession" } })));
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

export const signOutProgram = Effect.fn("rpc.signOut")(function* (req: { sessionToken: string }) {
  const headers = sessionCookieHeaders(req.sessionToken);
  // better-auth 1.6.9 の sign-out は hooks.after で session が設定されないため、先に lookup する。
  const authApi = yield* AuthApi;
  const result = yield* authApi
    .getSession(headers)
    .pipe(Effect.catchTag("AuthApiError", captureCauseAs(null, { tags: { handler: "signOut" } })));
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
});

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

    signOut: (req) => runRpc(signOutProgram(req)),

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
