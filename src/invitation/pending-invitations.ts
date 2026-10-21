import { Clock, Effect } from "effect";
import type { VerifiedMember } from "../membership/guard";
import { InvitationRepo } from "./ports";

export const pendingInvitationsOf = Effect.fnUntraced(function* (member: VerifiedMember<"ADMIN">) {
  const now = new Date(yield* Clock.currentTimeMillis);
  return yield* InvitationRepo.use((repo) => repo.listPendingInvitations(member.companyId, now));
});
