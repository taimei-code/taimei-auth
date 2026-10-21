import type { InvitationRow } from "@/db/repositories/invitation";
import type { Role } from "@/db/repositories/membership";
import type { Actor } from "../../account/actor-contract";
import type { RedirectTarget } from "../../sign-in-params";
import type {
  AcceptGrant,
  InviteGrant,
  OwnershipTransferGrant,
  RemovalGrant,
  RoleChangeGrant,
  VerifiedMember,
} from "../guard";
import { verified } from "../guard/verified";
import type { RoleAtLeast } from "../policy";

const actorOf = (id: string, email = `${id}@example.com`): Actor => ({
  id,
  email,
  lastUsedCompanyId: null,
});

export const memberForTest = <R extends Role>(
  actorUserId: string,
  companyId: string,
  role: R,
): VerifiedMember<R> => {
  const roleAtLeast: Role = role;
  return verified({ actor: actorOf(actorUserId), companyId, role: roleAtLeast as RoleAtLeast<R> });
};

export const inviteGrantForTest = (p: {
  actorUserId: string;
  companyId: string;
  email: string;
  role: Role;
  redirectTarget?: RedirectTarget;
}): InviteGrant =>
  verified({
    actor: actorOf(p.actorUserId),
    companyId: p.companyId,
    email: p.email,
    role: p.role,
    redirectTarget: p.redirectTarget,
  });

export const roleChangeGrantForTest = (p: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  beforeRole: Role;
  nextRole: Role;
}): RoleChangeGrant =>
  verified({
    actor: actorOf(p.actorUserId),
    companyId: p.companyId,
    targetUserId: p.targetUserId,
    targetRole: p.beforeRole,
    nextRole: p.nextRole,
  });

export const removalGrantForTest = (p: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  targetRole: Role;
}): RemovalGrant =>
  verified({
    actor: actorOf(p.actorUserId),
    companyId: p.companyId,
    targetUserId: p.targetUserId,
    targetRole: p.targetRole,
  });

export const transferGrantForTest = (p: {
  actorUserId: string;
  toUserId: string;
  companyId: string;
}): OwnershipTransferGrant =>
  verified({ actor: actorOf(p.actorUserId), companyId: p.companyId, toUserId: p.toUserId });

export const acceptGrantForTest = (p: {
  actor: { id: string; email: string };
  invitation: InvitationRow;
}): AcceptGrant =>
  verified({
    mode: "proceed" as const,
    actor: actorOf(p.actor.id, p.actor.email),
    invitation: p.invitation,
  });
