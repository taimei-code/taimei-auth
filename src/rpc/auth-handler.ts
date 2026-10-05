import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { buildSessionCookieHeader } from "@taimei-code/auth-client";
import { Effect } from "effect";
import type { UserRow } from "@/db/repositories/user";
import { UserRepo } from "../account/ports";
import type { Session } from "../auth";
import { AuthApi } from "../auth-service";
import type { AuthApiError, DbError } from "../errors";
import {
  AuthService,
  ListCurrentCompanyMembersOkSchema,
  ListCurrentCompanyMembersResponseSchema,
  Result,
  SessionSchema,
  UserSchema,
  VerifySessionErrorSchema,
  VerifySessionOkSchema,
  VerifySessionResponseSchema,
} from "../gen/auth/v1/auth_pb";
import { MembershipRepo } from "../membership/ports";
import { captureCause, type SentryService } from "../sentry";
import { toProtoCompanyMember, toProtoRole, toProtoSession, toProtoUser } from "./mappers";
import { runRpc } from "./run-rpc";

const verifySessionError = (reason: Result) =>
  create(VerifySessionResponseSchema, {
    outcome: {
      case: "error",
      value: create(VerifySessionErrorSchema, { reason }),
    },
  });

type SessionCheck =
  | { readonly _tag: "Verified"; readonly user: UserRow; readonly session: Session["session"] }
  | { readonly _tag: "Rejected"; readonly reason: Result };

const verifySessionUser = Effect.fn("rpc.verifySessionUser")(function* (
  sessionToken: string,
  handler: string,
): Effect.fn.Return<SessionCheck, AuthApiError | DbError, AuthApi | UserRepo | SentryService> {
  // session cookie だけを送るので、getSession は cookieCache でなく TTL store の payload を返す。
  const headers = new Headers({ cookie: buildSessionCookieHeader(sessionToken) });
  const authApi = yield* AuthApi;
  const result = yield* authApi.getSession(headers);

  if (!result?.user || !result?.session) {
    return { _tag: "Rejected", reason: Result.SESSION_NOT_FOUND };
  }

  const user = yield* UserRepo.use((users) => users.findUserById(result.user.id));
  if (!user) {
    return { _tag: "Rejected", reason: Result.USER_DELETED };
  }

  // revision 導入前の payload は field を持たない。undefined で判定を skip し、一斉ログアウトの loop を防ぐ。
  const cachedRevision: number | undefined = result.user.revision;
  if (cachedRevision !== undefined && user.revision !== cachedRevision) {
    yield* authApi.signOut(headers).pipe(Effect.catch(captureCause({ tags: { handler } })));
    return { _tag: "Rejected", reason: Result.REVISION_OUTDATED };
  }

  return { _tag: "Verified", user, session: result.session };
});

export const verifySessionProgram = Effect.fn("rpc.verifySession")(function* (req: {
  sessionToken: string;
}) {
  const check = yield* verifySessionUser(req.sessionToken, "verifySession");
  if (check._tag === "Rejected") {
    return verifySessionError(check.reason);
  }
  const { user, session } = check;

  const companyId = user.lastUsedCompanyId;
  const membership = companyId
    ? yield* MembershipRepo.use((repo) => repo.findMembership(user.id, companyId))
    : undefined;

  return create(VerifySessionResponseSchema, {
    outcome: {
      case: "ok",
      value: create(VerifySessionOkSchema, {
        user: create(UserSchema, toProtoUser(user)),
        session: create(SessionSchema, toProtoSession(session)),
        currentRole: membership ? toProtoRole(membership.role) : undefined,
      }),
    },
  });
});

const listMembersError = (reason: Result) =>
  create(ListCurrentCompanyMembersResponseSchema, {
    outcome: { case: "error", value: create(VerifySessionErrorSchema, { reason }) },
  });

const listMembersOk = (value: MessageInitShape<typeof ListCurrentCompanyMembersOkSchema>) =>
  create(ListCurrentCompanyMembersResponseSchema, {
    outcome: { case: "ok", value: create(ListCurrentCompanyMembersOkSchema, value) },
  });

export const listCurrentCompanyMembersProgram = Effect.fn("rpc.listCurrentCompanyMembers")(
  function* (req: { sessionToken: string }) {
    const check = yield* verifySessionUser(req.sessionToken, "listCurrentCompanyMembers");
    if (check._tag === "Rejected") {
      return listMembersError(check.reason);
    }

    const { user } = check;
    const companyId = user.lastUsedCompanyId;
    if (!companyId) {
      return listMembersOk({});
    }

    const members = yield* MembershipRepo.use((repo) => repo.findMembersByCompanyId(companyId));
    const callerStillMember = members.some((m) => m.userId === user.id);
    if (!callerStillMember) {
      return listMembersOk({});
    }

    const byJoinedAt = members.toSorted(
      (a, b) =>
        a.joinedAt.getTime() - b.joinedAt.getTime() || a.membershipId.localeCompare(b.membershipId),
    );
    return listMembersOk({ companyId, members: byJoinedAt.map(toProtoCompanyMember) });
  },
);

export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    verifySession: (req) => runRpc(verifySessionProgram(req)),
    listCurrentCompanyMembers: (req) => runRpc(listCurrentCompanyMembersProgram(req)),
  });
}
