// 相対 import なのは web の "@/" alias との誤解決を避けるため (詳細: role-label.ts の同制約)
import type { Role } from "../../db/repositories/membership";

export type { Role } from "../../db/repositories/membership";

// ADR-0012 (Guard 層): role 判定の純粋述語。web も @core alias 経由で使うため runtime import を
// 持たない (src/__tests__/web-shared-core-runtime-free.test.ts が固定)。

// OWNER > ADMIN > MEMBER の全順序。export しないのは直接 index lookup が未知 role を素通しさせるため。
const ROLE_LEVEL = { MEMBER: 0, ADMIN: 1, OWNER: 2 } as const;

// role 列は text で型保証がなく、prototype チェーン経由の lookup が未知 role を素通しさせる罠を防ぐ。
export function isAtLeast(role: string, minRole: Role): boolean {
  if (!Object.hasOwn(ROLE_LEVEL, role)) return false;
  return ROLE_LEVEL[role as Role] >= ROLE_LEVEL[minRole];
}

// 未知 role を保守側に倒す判定。export は accept use-case が拒否 reason ラベル (audit payload) を
// 分ける材料に使うため — 判定の SSOT は述語のまま。
export function isKnownRole(role: string): role is Role {
  return Object.hasOwn(ROLE_LEVEL, role);
}

// 未知 role も保護対象に含めて OWNER 保護の fail-open を防ぐ (server 述語と web の出し分けが共有)。
export function requiresOwnerProtection(role: string): boolean {
  return !isKnownRole(role) || role === "OWNER";
}

// before/next のどちらかが OWNER に触れる変更は OWNER のみ許可 (ADMIN は昇格も降格も承認できない)。
export function canChangeRole(actorRole: Role, beforeRole: Role, nextRole: Role): boolean {
  const touchesOwner = requiresOwnerProtection(beforeRole) || nextRole === "OWNER";
  return touchesOwner ? actorRole === "OWNER" : true;
}

// role=OWNER の招待は OWNER のみ。ADMIN が invitation 経由で新規 OWNER を mint する回避路
// (accept 時に canChangeRole の OWNER ガードを迂回) を塞ぐ (Issue #104)。
export function canInviteRole(actorRole: Role, invitedRole: Role): boolean {
  return invitedRole === "OWNER" ? actorRole === "OWNER" : true;
}

// target 取得前の除名資格判定。本人退会は無条件、他者除名は ADMIN 以上。
export function canAttemptRemoval(actorRole: Role, isSelf: boolean): boolean {
  return isSelf || isAtLeast(actorRole, "ADMIN");
}

// target 取得後の OWNER 保護判定。OWNER を他者が抜くのは OWNER のみ。
export function canRemoveTarget(actorRole: Role, isSelf: boolean, targetRole: Role): boolean {
  return !(requiresOwnerProtection(targetRole) && !isSelf && actorRole !== "OWNER");
}

// OWNER 招待の accept は招待者が accept 時点で現役 OWNER のときだけ通す (降格 / 除名後の mint を塞ぐ)。
// ADMIN/MEMBER 招待を inviter 状態に依存させないのは招待者退会の正規ケースを壊さないため (ADR-0012)。
export function canAcceptInvitedRole(
  invitedRole: string,
  inviterCurrentRole: string | null,
): boolean {
  if (!isKnownRole(invitedRole)) return false;
  if (invitedRole !== "OWNER") return true;
  return inviterCurrentRole === "OWNER";
}
