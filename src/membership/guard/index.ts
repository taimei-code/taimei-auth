// membership guard 層の公開 façade。handler / rpc / tests は `../membership/guard` の 1 path で
// 全ての entry と Result 型 / guardErrorResponse を得る。operation 単位 entry の追加は
// このディレクトリ配下に 1 file 1 操作で足し、ここから re-export する。
// 詳細: docs/adr/0012-layered-architecture.md

export {
  createMembershipGuard,
  guard,
  resolveParseBody,
  type Actor,
  type ActorResult,
  type MembershipGuardResult,
  type GuardDeps,
  type MembershipGuard,
  type Forbidden,
  type NotFound,
  type InvalidArgument,
  type Unauthorized,
  type ParseBodyCallback,
  type ParseBodyResult,
} from "./core";

// 本番用 default guard の generic entry (requireActor / requireMembership / requireMembershipOf)。
// module ロード時 bind 済み。DI テストは createMembershipGuard を直接呼ぶ。
import { guard } from "./core";
export const requireActor = guard.requireActor;
export const requireMembership = guard.requireMembership;
export const requireMembershipOf = guard.requireMembershipOf;

export { guardErrorResponse } from "./respond";
export type { GuardErrorResult } from "./respond";

export {
  makeRequireRoleChange,
  requireRoleChange,
  type ParsedRoleBody,
  type RoleChangeGuardResult,
} from "./role-change";
export {
  makeRequireRemoval,
  requireRemoval,
  type RemovalGuardResult,
} from "./removal";
export {
  makeRequireTransferOwnership,
  requireTransferOwnership,
  type ParsedTransferBody,
  type TransferOwnershipGuardResult,
} from "./transfer-ownership";
export {
  makeRequireInvite,
  requireInvite,
  type InviteGuardResult,
  type ParsedInviteBody,
} from "./invite";
export {
  makeRequireInvitationAccept,
  requireInvitationAccept,
  type InvitationAcceptGuardResult,
  type ParsedAcceptBody,
} from "./invitation-accept";
