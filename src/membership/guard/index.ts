// membership guard 層の公開 façade (ADR-0012)。operation 単位 entry は同 dir に 1 file 1 操作で足し、
// ここから re-export する。

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

// 本番用 default guard の generic entry (module ロード時 bind 済み)。DI テストは createMembershipGuard を直接呼ぶ。
import { guard } from "./core";
export const requireActor = guard.requireActor;
export const requireMembership = guard.requireMembership;
export const requireMembershipOf = guard.requireMembershipOf;

export { guardErrorResponse, reasonToGuardError } from "./respond";
export type { GuardErrorResult, GuardReason } from "./respond";

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
