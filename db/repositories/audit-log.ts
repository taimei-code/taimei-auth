import { randomUUID } from "node:crypto";
import { db } from "../client";
import { auditLog, type OrgCode, type Role } from "../schema";
import type { DbOrTx } from "../transaction";
import type { InviterSeen } from "./membership";

export type RejectReason = "double_accept" | "inviter_not_owner_or_missing";

export type AuditLogEntry =
  | {
      eventType: "sign_in";
      userId: string;
      payload: { method: "magic_link" | "github"; ip: string; userAgent: string };
    }
  | {
      eventType: "mfa_enabled";
      userId: string;
      payload: { ip: string | null; userAgent: string };
    }
  | {
      eventType: "mfa_disabled";
      userId: string;
      payload: { ip: string | null; userAgent: string };
    }
  | {
      eventType: "account_delete";
      userId: string;
      payload: Record<string, never>;
    }
  | {
      eventType: "company_created";
      userId: string;
      payload: {
        company_id: string;
        name: string;
        org_code: OrgCode;
        created_by_user_id: string;
      };
    }
  | {
      eventType: "company_updated";
      userId: string;
      payload: {
        company_id: string;
        before: { name: string; org_code: OrgCode };
        after: { name: string; org_code: OrgCode };
      };
    }
  | {
      eventType: "company_deleted";
      userId: string;
      payload: {
        company_id: string;
        name_at_deletion: string;
        deleted_by_user_id: string;
      };
    }
  | {
      eventType: "invitation_sent";
      userId: string;
      payload: {
        invitation_id: string;
        company_id: string;
        invited_email: string;
        role: Role;
        invited_by_user_id: string;
      };
    }
  | {
      eventType: "invitation_accepted";
      userId: string;
      payload: {
        invitation_id: string;
        company_id: string;
        accepted_by_user_id: string;
        role: Role;
      };
    }
  | {
      eventType: "invitation_revoked";
      userId: string;
      payload: {
        invitation_id: string;
        company_id: string;
        revoked_by_user_id: string;
      };
    }
  | {
      eventType: "invitation_accept_rejected";
      userId: string;
      payload: {
        invitation_id: string;
        company_id: string;
        invited_by_user_id: string;
        attempted_role: Role;
        inviter: InviterSeen | null;
        reason: RejectReason;
      };
    }
  | {
      eventType: "membership_removed";
      userId: string;
      payload: {
        company_id: string;
        removed_user_id: string;
        removed_by_user_id: string;
        role_at_removal: Role;
        was_self: boolean;
      };
    }
  | {
      eventType: "role_changed";
      userId: string;
      payload: {
        company_id: string;
        target_user_id: string;
        before_role: Role;
        after_role: Role;
        changed_by_user_id: string;
      };
    }
  | {
      eventType: "ownership_transferred";
      userId: string;
      payload: {
        company_id: string;
        from_user_id: string;
        to_user_id: string;
      };
    }
  | {
      eventType: "company_switched";
      userId: string;
      payload: {
        from_company_id: string | null;
        to_company_id: string;
      };
    };

export async function appendAuditLog(entry: AuditLogEntry, txOrDb: DbOrTx = db): Promise<void> {
  await appendAuditLogs([entry], txOrDb);
}

export async function appendAuditLogs(
  entries: AuditLogEntry[],
  txOrDb: DbOrTx = db,
): Promise<void> {
  if (entries.length === 0) return;
  await txOrDb.insert(auditLog).values(
    entries.map((entry) => ({
      id: randomUUID(),
      eventType: entry.eventType,
      userId: entry.userId,
      payload: entry.payload,
    })),
  );
}
