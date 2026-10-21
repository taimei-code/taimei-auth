import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { changeRole } from "../membership/change-role";
import { listMembers } from "../membership/list-members";
import {
  requireMembershipOf,
  requireRemoval,
  requireRoleChange,
  requireTransferOwnership,
} from "../membership/guard";
import { removeMember } from "../membership/remove";
import { transferOwnership } from "../membership/transfer-ownership";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

export const MembershipHandlers = HttpApiBuilder.group(SpaApi, "membership", (handlers) =>
  handlers.handleAll({
    list: Effect.fnUntraced(function* ({ params }) {
      const member = yield* requireMembershipOf(yield* CurrentActor, params.companyId, "MEMBER");
      const members = yield* listMembers(member);
      return {
        members: members.map((m) => ({
          membership_id: m.membershipId,
          user_id: m.userId,
          user_name: m.userName,
          user_email: m.userEmail,
          role: m.role,
          joined_at: m.joinedAt.toISOString(),
        })),
      };
    }, dieOnBoundary),
    changeRole: Effect.fnUntraced(function* ({ params, payload }) {
      const grant = yield* requireRoleChange({
        actor: yield* CurrentActor,
        companyId: params.companyId,
        targetUserId: params.targetUserId,
        nextRole: payload.role,
      });
      yield* changeRole(grant);
      return { ok: true as const };
    }, dieOnBoundary),
    remove: Effect.fnUntraced(function* ({ params }) {
      const grant = yield* requireRemoval({
        actor: yield* CurrentActor,
        companyId: params.companyId,
        targetUserId: params.targetUserId,
      });
      const result = yield* removeMember(grant);
      return { ok: true as const, account_deleted: result.accountDeleted };
    }, dieOnBoundary),
    transferOwnership: Effect.fnUntraced(function* ({ params, payload }) {
      const grant = yield* requireTransferOwnership({
        actor: yield* CurrentActor,
        companyId: params.companyId,
        toUserId: payload.to_user_id,
      });
      yield* transferOwnership(grant);
      return { ok: true as const };
    }, dieOnBoundary),
  }),
);
