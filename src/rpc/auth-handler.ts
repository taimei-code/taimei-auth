import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { buildSessionCookieHeader } from "@taimei-code/auth-client";
import { Effect } from "effect";
import { UserRepo } from "../account/ports";
import { AuthApi } from "../auth-service";
import {
  AuthService,
  GetMembershipResponseSchema,
  Result,
  SessionSchema,
  UserSchema,
  VerifySessionErrorSchema,
  VerifySessionOkSchema,
  VerifySessionResponseSchema,
} from "../gen/auth/v1/auth_pb";
import { MembershipRepo } from "../membership/ports";
import { captureCause } from "../sentry";
import { toProtoRole, toProtoSession, toProtoUser } from "./mappers";
import { runRpc } from "./run-rpc";

const verifySessionError = (reason: Result) =>
  create(VerifySessionResponseSchema, {
    outcome: {
      case: "error",
      value: create(VerifySessionErrorSchema, { reason }),
    },
  });

export const verifySessionProgram = Effect.fn("rpc.verifySession")(function* (req: {
  sessionToken: string;
}) {
  // session cookie だけを送るので、getSession は cookieCache でなく TTL store の payload を返す。
  const headers = new Headers({ cookie: buildSessionCookieHeader(req.sessionToken) });
  const authApi = yield* AuthApi;
  const result = yield* authApi.getSession(headers);

  if (!result?.user || !result?.session) {
    return verifySessionError(Result.SESSION_NOT_FOUND);
  }

  const dbUser = yield* UserRepo.use((users) => users.findUserById(result.user.id));
  if (!dbUser) {
    return verifySessionError(Result.USER_DELETED);
  }

  // revision 導入前の payload は field を持たない。undefined で判定を skip し、一斉ログアウトの loop を防ぐ。
  const cachedRevision: number | undefined = result.user.revision;
  if (cachedRevision !== undefined && dbUser.revision !== cachedRevision) {
    yield* authApi
      .signOut(headers)
      .pipe(Effect.catch(captureCause({ tags: { handler: "verifySession" } })));
    return verifySessionError(Result.REVISION_OUTDATED);
  }

  const companyId = dbUser.lastUsedCompanyId;
  const currentMembership = companyId
    ? yield* MembershipRepo.use((repo) => repo.findMembership(dbUser.id, companyId))
    : undefined;

  return create(VerifySessionResponseSchema, {
    outcome: {
      case: "ok",
      value: create(VerifySessionOkSchema, {
        user: create(UserSchema, toProtoUser(dbUser)),
        session: create(SessionSchema, toProtoSession(result.session)),
        currentRole: currentMembership ? toProtoRole(currentMembership.role) : undefined,
      }),
    },
  });
});

export const getMembershipProgram = Effect.fn("rpc.getMembership")(function* (req: {
  userId: string;
  companyId: string;
}) {
  const row = yield* MembershipRepo.use((repo) => repo.findMembership(req.userId, req.companyId));
  return create(GetMembershipResponseSchema, { role: row ? toProtoRole(row.role) : undefined });
});

export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    verifySession: (req) => runRpc(verifySessionProgram(req)),
    getMembership: (req) => runRpc(getMembershipProgram(req)),
  });
}
