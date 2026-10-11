import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { changeRole } from "../membership/change-role";
import {
  requireMembershipOf,
  requireRemoval,
  requireRoleChange,
  requireTransferOwnership,
} from "../membership/guard";
import { MembershipRepo } from "../membership/ports";
import { removeMember } from "../membership/remove";
import { transferOwnership } from "../membership/transfer-ownership";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

export const MembershipHandlers = HttpApiBuilder.group(SpaApi, "membership", (handlers) =>
  handlers
    .handle("list", ({ params }) =>
      Effect.gen(function* () {
        yield* requireMembershipOf(yield* CurrentActor, params.companyId);
        const members = yield* MembershipRepo.use((repo) =>
          repo.findMembersByCompanyId(params.companyId),
        );
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
      }).pipe(dieOnBoundary),
    )
    .handle("changeRole", ({ params, payload }) =>
      Effect.gen(function* () {
        const grant = yield* requireRoleChange({
          actor: yield* CurrentActor,
          companyId: params.companyId,
          targetUserId: params.targetUserId,
          nextRole: payload.role,
        });
        yield* changeRole({
          actorUserId: grant.actor.id,
          targetUserId: params.targetUserId,
          companyId: params.companyId,
          beforeRole: grant.targetRole,
          nextRole: grant.nextRole,
        });
        return { ok: true as const };
      }).pipe(dieOnBoundary),
    )
    .handle("remove", ({ params }) =>
      Effect.gen(function* () {
        const { actor, targetRole } = yield* requireRemoval({
          actor: yield* CurrentActor,
          companyId: params.companyId,
          targetUserId: params.targetUserId,
        });
        const result = yield* removeMember({
          actorUserId: actor.id,
          targetUserId: params.targetUserId,
          companyId: params.companyId,
          targetRole,
        });
        return { ok: true as const, account_deleted: result.accountDeleted };
      }).pipe(dieOnBoundary),
    )
    .handle("transferOwnership", ({ params, payload }) =>
      Effect.gen(function* () {
        const grant = yield* requireTransferOwnership({
          actor: yield* CurrentActor,
          companyId: params.companyId,
          toUserId: payload.to_user_id,
        });
        yield* transferOwnership({
          actorUserId: grant.actor.id,
          toUserId: grant.toUserId,
          companyId: params.companyId,
        });
        return { ok: true as const };
      }).pipe(dieOnBoundary),
    ),
);
