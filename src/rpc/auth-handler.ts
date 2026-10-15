import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { buildSessionCookieHeader } from "@taimei-code/auth-client";
import { Effect } from "effect";
import type { MemberRow } from "@/db/repositories/membership";
import type { UserRow } from "@/db/repositories/user";
import { UserRepo } from "../account/ports";
import type { Session } from "../auth";
import { AuthApi } from "../auth-service";
import type { AuthApiError, DbError } from "../errors";
import {
  AuthService,
  GetSessionOkSchema,
  GetSessionResponseSchema,
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
import { checkSession } from "../session-check";
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

const verifySessionUser = Effect.fnUntraced(function* (
  sessionToken: string,
  handler: string,
): Effect.fn.Return<SessionCheck, AuthApiError | DbError, AuthApi | UserRepo | SentryService> {
  const headers = new Headers({ cookie: buildSessionCookieHeader(sessionToken) });
  const status = yield* checkSession(headers);
  if (status._tag === "NoSession") {
    return { _tag: "Rejected", reason: Result.SESSION_NOT_FOUND };
  }
  if (status._tag === "UserDeleted") {
    return { _tag: "Rejected", reason: Result.USER_DELETED };
  }

  const { session, user } = status;
  const cachedRevision: number | undefined = session.user.revision;
  if (cachedRevision !== undefined && user.revision !== cachedRevision) {
    yield* AuthApi.use((authApi) => authApi.signOut(headers)).pipe(
      Effect.catch(captureCause({ tags: { handler } })),
    );
    return { _tag: "Rejected", reason: Result.REVISION_OUTDATED };
  }

  return { _tag: "Verified", user, session: session.session };
});

const sessionSeenByConsumer = (
  user: UserRow,
  session: Session["session"],
  role: MemberRow["role"] | undefined,
) => ({
  user: create(UserSchema, toProtoUser(user)),
  session: create(SessionSchema, toProtoSession(session)),
  currentRole: role ? toProtoRole(role) : undefined,
});

export const verifySessionProgram = Effect.fnUntraced(function* (req: { sessionToken: string }) {
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
      value: create(VerifySessionOkSchema, sessionSeenByConsumer(user, session, membership?.role)),
    },
  });
});

const oldestJoinedFirst = (members: readonly MemberRow[]) =>
  members.toSorted(
    (a, b) =>
      a.joinedAt.getTime() - b.joinedAt.getTime() || a.membershipId.localeCompare(b.membershipId),
  );

const listMembersError = (reason: Result) =>
  create(ListCurrentCompanyMembersResponseSchema, {
    outcome: { case: "error", value: create(VerifySessionErrorSchema, { reason }) },
  });

const listMembersOk = (value: MessageInitShape<typeof ListCurrentCompanyMembersOkSchema>) =>
  create(ListCurrentCompanyMembersResponseSchema, {
    outcome: { case: "ok", value: create(ListCurrentCompanyMembersOkSchema, value) },
  });

const currentCompanyMembers = Effect.fnUntraced(function* (user: UserRow) {
  const companyId = user.lastUsedCompanyId;
  if (!companyId) return undefined;
  const members = yield* MembershipRepo.use((repo) => repo.findMembersByCompanyId(companyId));
  const caller = members.find((m) => m.userId === user.id);
  return caller && { companyId, callerRole: caller.role, members: oldestJoinedFirst(members) };
});

export const listCurrentCompanyMembersProgram = Effect.fnUntraced(function* (req: {
  sessionToken: string;
}) {
  const check = yield* verifySessionUser(req.sessionToken, "listCurrentCompanyMembers");
  if (check._tag === "Rejected") {
    return listMembersError(check.reason);
  }

  const current = yield* currentCompanyMembers(check.user);
  return listMembersOk(
    current
      ? { companyId: current.companyId, members: current.members.map(toProtoCompanyMember) }
      : {},
  );
});

const getSessionError = (reason: Result) =>
  create(GetSessionResponseSchema, {
    outcome: { case: "error", value: create(VerifySessionErrorSchema, { reason }) },
  });

export const getSessionProgram = Effect.fnUntraced(function* (req: { sessionToken: string }) {
  const check = yield* verifySessionUser(req.sessionToken, "getSession");
  if (check._tag === "Rejected") {
    return getSessionError(check.reason);
  }
  const { user, session } = check;
  const current = yield* currentCompanyMembers(user);

  return create(GetSessionResponseSchema, {
    outcome: {
      case: "ok",
      value: create(GetSessionOkSchema, {
        ...sessionSeenByConsumer(user, session, current?.callerRole),
        members: current ? current.members.map(toProtoCompanyMember) : [],
      }),
    },
  });
});

export function registerAuthService(router: ConnectRouter) {
  router.service(AuthService, {
    verifySession: (req) => runRpc(verifySessionProgram(req)),
    listCurrentCompanyMembers: (req) => runRpc(listCurrentCompanyMembersProgram(req)),
    getSession: (req) => runRpc(getSessionProgram(req)),
  } satisfies ServiceImpl<typeof AuthService>);
}
