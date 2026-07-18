import type { Role } from "@/db/repositories/membership";

// membership guard の role 判定を担う純粋関数群。I/O は持たない (guard.ts から分離、cohesion 改善のため)。

// OWNER > ADMIN > MEMBER の全順序。minRole 比較を「以上」で書けるようにする。export しないのは
// 直接 index lookup を外へ漏らすと未知 role の素通しを再現するため。判定は isAtLeast に閉じる。
const ROLE_LEVEL = { MEMBER: 0, ADMIN: 1, OWNER: 2 } as const;

// role が Role の値でない (unknown 文字列 or Object.prototype 上のキー名) 場合は false。
// role 列は text で型保証がなく、prototype チェーン経由の lookup が role を素通しさせる罠を防ぐ。
export function isAtLeast(role: string, minRole: Role): boolean {
  if (!Object.hasOwn(ROLE_LEVEL, role)) return false;
  return ROLE_LEVEL[role as Role] >= ROLE_LEVEL[minRole];
}

// role が Role 値集合に属するかの判定。未知 role の target を保守側に倒す policy 用。
function isKnownRole(role: string): role is Role {
  return Object.hasOwn(ROLE_LEVEL, role);
}

// role 変更の可否: before/next のどちらかが OWNER に触れる変更は OWNER のみ許可 (ADMIN は
// OWNER への昇格も OWNER の降格も承認できない)。OWNER に触れない変更は所属していれば可。
// 未知の beforeRole は保守側 (OWNER 相当) に扱い、ADMIN の任意操作を許さない。
export function canChangeRole(actorRole: Role, beforeRole: Role, nextRole: Role): boolean {
  const touchesOwner = !isKnownRole(beforeRole) || beforeRole === "OWNER" || nextRole === "OWNER";
  return touchesOwner ? actorRole === "OWNER" : true;
}

// target 取得前の除名資格判定。本人退会は無条件、他者除名は ADMIN 以上。
export function canAttemptRemoval(actorRole: Role, isSelf: boolean): boolean {
  return isSelf || isAtLeast(actorRole, "ADMIN");
}

// target 取得後の OWNER 保護判定。OWNER を他者が抜くのは OWNER のみ。
// 未知の targetRole は保守側 (OWNER 相当) に扱い、ADMIN の任意除名を許さない。
export function canRemoveTarget(actorRole: Role, isSelf: boolean, targetRole: Role): boolean {
  const targetIsOwnerLike = !isKnownRole(targetRole) || targetRole === "OWNER";
  return !(targetIsOwnerLike && !isSelf && actorRole !== "OWNER");
}
