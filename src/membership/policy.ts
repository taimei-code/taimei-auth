// 相対 import なのは、web が @core alias 経由で本 file を読む際に "@/db/..." だと web 側の
// "@/" alias (web/src/) で誤解決するため (role-label.ts と同じ制約)。type-only import は
// build で消え web bundle に db は入らない。
import type { Role } from "../../db/repositories/membership";

// membership guard の role 判定を担う純粋関数群。I/O は持たない (guard.ts から分離、cohesion 改善のため)。
// web が @core alias 経由で UI の出し分けにも使う共有実装のため、この file に runtime 依存
// (db / resend 等) を足さないこと (role-label.ts と同じ制約)。

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
// export しているのは accept use-case が **判定本体は述語に委ねたまま**、拒否 reason ラベル
// (unknown_invited_role vs inviter_not_owner_or_missing) を audit payload に分ける用途で
// isKnownRole の結果を "reason 命名の材料" として参照するため。判定の SSOT は述語のまま。
export function isKnownRole(role: string): role is Role {
  return Object.hasOwn(ROLE_LEVEL, role);
}

// role 列は text で型保証がなく未知文字列 (prototype 上のキー名を含む) が届きうるため、
// 未知 role も保護対象に含めて OWNER 保護の fail-open を防ぐ。server の述語
// (canChangeRole / canRemoveTarget) と web の出し分け (Members) が同じ判定を共有する。
export function requiresOwnerProtection(role: string): boolean {
  return !isKnownRole(role) || role === "OWNER";
}

// role 変更の可否: before/next のどちらかが OWNER に触れる変更は OWNER のみ許可 (ADMIN は
// OWNER への昇格も OWNER の降格も承認できない)。OWNER に触れない変更は所属していれば可。
export function canChangeRole(actorRole: Role, beforeRole: Role, nextRole: Role): boolean {
  const touchesOwner = requiresOwnerProtection(beforeRole) || nextRole === "OWNER";
  return touchesOwner ? actorRole === "OWNER" : true;
}

// 招待できる role の可否: role=OWNER の招待は OWNER のみ発行可能、それ以外は所属権限内で発行可。
// canChangeRole が role 変更経路で「OWNER に触れる変更は OWNER のみ」を強制するのと同じ policy を
// 招待経路にも適用し、ADMIN が invitation 経由で新規 OWNER を mint する回避路 (accept 時に
// transfer-ownership / canChangeRole の OWNER ガードを迂回) を塞ぐ (Issue #104)。
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

// 招待受諾時の OWNER mint 再検証。invitation.role === "OWNER" の accept は、招待者が accept 時点で
// 現役 OWNER である場合のみ通す (ADMIN 降格 / 除名後の招待者からの mint を塞ぐ)。呼び出し側は
// OWNER 招待のとき lock+fetch した inviter role (無ければ null) を、OWNER 招待以外のとき null を
// 渡す形にし、この述語を 1 回だけ呼ぶ (accept use-case)。判定分岐:
//   (a) invitedRole が未知 → false (isKnownRole 経由 fail-closed、prototype 汚染 role 名も含む)
//   (b) invitedRole !== "OWNER" → true (ADMIN/MEMBER 招待は inviter 状態に依存しない — 招待者退会の
//       正規ケースを壊さない設計判断、ADR-0012 参照)
//   (c) invitedRole === "OWNER" → inviterCurrentRole === "OWNER" のときだけ true (未知の inviter
//       role string や null は "OWNER" と等値でないため自然に false に落ち、追加分岐不要)
export function canAcceptInvitedRole(
  invitedRole: string,
  inviterCurrentRole: string | null,
): boolean {
  if (!isKnownRole(invitedRole)) return false;
  if (invitedRole !== "OWNER") return true;
  return inviterCurrentRole === "OWNER";
}
