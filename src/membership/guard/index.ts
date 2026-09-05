// membership guard 層の公開 façade (ADR-0012 / ADR-0017)。公開 API は Effect のみ。operation 単位 entry は
// 同 dir に 1 file 1 操作で足し、ここから re-export する。失敗 class は errors.ts (wire code と status を持つ)。
// 置くのは façade 経由で実際に import される名前だけ。他 module から直接参照される失敗 class は ./errors から取る。

export { type ParseBody, requireActor, requireMembership, requireMembershipOf } from "./core";
export { requireInvitationAccept } from "./invitation-accept";
export { requireInvite } from "./invite";
export { requireRemoval } from "./removal";
export { requireRoleChange } from "./role-change";
export { requireTransferOwnership } from "./transfer-ownership";
