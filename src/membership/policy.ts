// 相対 import ("@/" は web 側の alias として解決される)。
import type { InviterSeen, Role } from "../../db/repositories/membership";

export type { Role } from "../../db/repositories/membership";

const ROLE_LEVEL = { MEMBER: 0, ADMIN: 1, OWNER: 2 } as const;

export function isAtLeast(role: Role, minRole: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

export function canChangeRole(actorRole: Role, beforeRole: Role, nextRole: Role): boolean {
  const touchesOwner = beforeRole === "OWNER" || nextRole === "OWNER";
  return touchesOwner ? actorRole === "OWNER" : true;
}

export function canInviteRole(actorRole: Role, invitedRole: Role): boolean {
  return invitedRole === "OWNER" ? actorRole === "OWNER" : true;
}

export function canAttemptRemoval(actorRole: Role, isSelf: boolean): boolean {
  return isSelf || isAtLeast(actorRole, "ADMIN");
}

export function canRemoveTarget(actorRole: Role, isSelf: boolean, targetRole: Role): boolean {
  return !(targetRole === "OWNER" && !isSelf && actorRole !== "OWNER");
}

export type InviterVerdict =
  | { readonly _tag: "Accept" }
  | { readonly _tag: "Reject"; readonly seen: InviterSeen };

export function verifyInviter(found: { readonly role: Role } | undefined): InviterVerdict {
  if (found === undefined) return { _tag: "Reject", seen: { _tag: "Missing" } };
  return found.role === "OWNER"
    ? { _tag: "Accept" }
    : { _tag: "Reject", seen: { _tag: "Demoted", role: found.role } };
}
