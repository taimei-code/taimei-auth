import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { Effect } from "effect";
import {
  AuthService,
  CompanyMemberSchema,
  GetSessionOkSchema,
  GetSessionResponseSchema,
  Result,
  Role,
  SessionSchema,
  UserSchema,
  VerifySessionErrorSchema,
} from "../gen/auth/v1/auth_pb";
import { getSessionByCookie } from "./consumer-rpc";
import { runRpc } from "./run-rpc";

const REASON = {
  SESSION_NOT_FOUND: Result.SESSION_NOT_FOUND,
  USER_DELETED: Result.USER_DELETED,
  REVISION_OUTDATED: Result.REVISION_OUTDATED,
} as const;

const getSessionProgram = (cookieHeader: string) =>
  getSessionByCookie(cookieHeader).pipe(
    Effect.map((result) =>
      result._tag === "Rejected"
        ? create(GetSessionResponseSchema, {
            outcome: { case: "error", value: create(VerifySessionErrorSchema, { reason: REASON[result.reason] }) },
          })
        : create(GetSessionResponseSchema, {
            outcome: {
              case: "ok",
              value: create(GetSessionOkSchema, {
                user: create(UserSchema, { ...result.user, image: result.user.image ?? undefined }),
                session: create(SessionSchema, { ...result.session, sessionKind: "user" }),
                companyId: result.companyId ?? undefined,
                role: result.role === null ? undefined : Role[result.role],
                members: result.members.map((m) => create(CompanyMemberSchema, { ...m, role: Role[m.role] })),
              }),
            },
          }),
    ),
  );

export function registerGetSession(router: ConnectRouter) {
  router.rpc(AuthService.method.getSession, (req) => runRpc(getSessionProgram(req.cookieHeader)));
}
