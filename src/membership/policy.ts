// 相対 import なのは web の "@/" alias との誤解決を避けるため。
import type { Role } from "../../db/repositories/membership";

export type { Role } from "../../db/repositories/membership";

const ROLE_LEVEL = { MEMBER: 0, ADMIN: 1, OWNER: 2 } as const;

export function isAtLeast(role: Role, minRole: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

export function canChangeRole(actorRole: Role, beforeRole: Role, nextRole: Role): boolean {
  const touchesOwner = beforeRole === "OWNER" || nextRole === "OWNER";
  return touchesOwner ? actorRole === "OWNER" : true;
}

// ADMIN が invitation 経由で OWNER を mint する迂回路を塞ぐ (Issue #104)。
export function canInviteRole(actorRole: Role, invitedRole: Role): boolean {
  return invitedRole === "OWNER" ? actorRole === "OWNER" : true;
}

export function canAttemptRemoval(actorRole: Role, isSelf: boolean): boolean {
  return isSelf || isAtLeast(actorRole, "ADMIN");
}

export function canRemoveTarget(actorRole: Role, isSelf: boolean, targetRole: Role): boolean {
  return !(targetRole === "OWNER" && !isSelf && actorRole !== "OWNER");
}

// OWNER 招待だけ招待者の現役 OWNER を要求するのは、降格 / 除名後の mint を塞ぐため。
export function canAcceptInvitedRole(invitedRole: Role, inviterCurrentRole: Role | null): boolean {
  if (invitedRole !== "OWNER") return true;
  return inviterCurrentRole === "OWNER";
}
