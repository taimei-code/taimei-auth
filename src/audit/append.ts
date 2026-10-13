import { Effect } from "effect";
import type { AuditLogEntry } from "@/db/repositories/audit-log";
import type { Role } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { getClientContext } from "../request-context";
import { captureCause } from "../sentry";
import { AuditLog } from "./ports";

export const appendAuditInTx = (tx: DbTx, ...entries: AuditLogEntry[]) =>
  AuditLog.use((audit) => audit.appendAuditLogs(entries, tx));

export const appendAuditBestEffort = (entry: AuditLogEntry) =>
  AuditLog.use((audit) => audit.appendAuditLog(entry)).pipe(
    Effect.catch(
      captureCause({ level: "error", tags: { component: "audit-log", event: entry.eventType } }),
    ),
  );

type SignInMethod = Extract<AuditLogEntry, { eventType: "sign_in" }>["payload"]["method"];

export const signInEntry = (
  userId: string,
  method: SignInMethod,
  headers: Headers | null | undefined,
): AuditLogEntry => {
  const { ip, userAgent } = getClientContext(headers);
  return { eventType: "sign_in", userId, payload: { method, ip, userAgent } };
};

type RemovedMembership = { companyId: string; userId: string; role: Role };

export const membershipRemovedEntry = (
  actorUserId: string,
  removed: RemovedMembership,
): AuditLogEntry => ({
  eventType: "membership_removed",
  userId: actorUserId,
  payload: {
    company_id: removed.companyId,
    removed_user_id: removed.userId,
    removed_by_user_id: actorUserId,
    role_at_removal: removed.role,
    was_self: actorUserId === removed.userId,
  },
});

export const invitationRevokedEntry = (
  actorUserId: string,
  revoked: { invitationId: string; companyId: string },
): AuditLogEntry => ({
  eventType: "invitation_revoked",
  userId: actorUserId,
  payload: {
    invitation_id: revoked.invitationId,
    company_id: revoked.companyId,
    revoked_by_user_id: actorUserId,
  },
});
