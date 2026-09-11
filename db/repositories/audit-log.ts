import { randomUUID } from "node:crypto";
import { db } from "../client";
import { auditLog, type OrgCode, type Role } from "../schema";
import type { DbOrTx } from "../transaction";

export type AuditLogEntry =
  | {
      eventType: "sign_in";
      userId: string;
      payload: { method: "magic_link" | "github"; ip: string; userAgent: string };
    }
  | {
      eventType: "sign_out";
      userId: string;
      payload: { ip: string; userAgent: string };
    }
  // secret / リカバリーコード / 残数は載せない (監査ログ閲覧を second factor の漏洩経路にしない)。
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
        inviter_current_role: Role | null;
        reason: string;
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

// FOR UPDATE lock 保持中の tx で N 回 INSERT すると lock 時間が round trip × N に伸びるため batch にする。
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

export const recordAccountDeleted = (
  params: { user_id: string },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog({ eventType: "account_delete", userId: params.user_id, payload: {} }, txOrDb);

export const recordCompanyCreated = (
  params: {
    actor_user_id: string;
    company_id: string;
    name: string;
    org_code: OrgCode;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "company_created",
      userId: params.actor_user_id,
      payload: {
        company_id: params.company_id,
        name: params.name,
        org_code: params.org_code,
        created_by_user_id: params.actor_user_id,
      },
    },
    txOrDb,
  );

export const recordInvitationSent = (
  params: {
    actor_user_id: string;
    invitation_id: string;
    company_id: string;
    invited_email: string;
    role: Role;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "invitation_sent",
      userId: params.actor_user_id,
      payload: {
        invitation_id: params.invitation_id,
        company_id: params.company_id,
        invited_email: params.invited_email,
        role: params.role,
        invited_by_user_id: params.actor_user_id,
      },
    },
    txOrDb,
  );

export const recordInvitationAccepted = (
  params: {
    actor_user_id: string;
    invitation_id: string;
    company_id: string;
    role: Role;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "invitation_accepted",
      userId: params.actor_user_id,
      payload: {
        invitation_id: params.invitation_id,
        company_id: params.company_id,
        accepted_by_user_id: params.actor_user_id,
        role: params.role,
      },
    },
    txOrDb,
  );

export const recordInvitationRevoked = (
  params: {
    actor_user_id: string;
    invitation_id: string;
    company_id: string;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  recordInvitationsRevoked(
    {
      actor_user_id: params.actor_user_id,
      company_id: params.company_id,
      invitation_ids: [params.invitation_id],
    },
    txOrDb,
  );

// payload の key set は監視 query 互換のため固定し PII は含めない。
export const recordInvitationAcceptRejected = (
  params: {
    actor_user_id: string;
    invitation_id: string;
    company_id: string;
    invited_by_user_id: string;
    attempted_role: Role;
    inviter_current_role: Role | null;
    reason: string;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "invitation_accept_rejected",
      userId: params.actor_user_id,
      payload: {
        invitation_id: params.invitation_id,
        company_id: params.company_id,
        invited_by_user_id: params.invited_by_user_id,
        attempted_role: params.attempted_role,
        inviter_current_role: params.inviter_current_role,
        reason: params.reason,
      },
    },
    txOrDb,
  );

export const recordRoleChanged = (
  params: {
    actor_user_id: string;
    company_id: string;
    target_user_id: string;
    before_role: Role;
    after_role: Role;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "role_changed",
      userId: params.actor_user_id,
      payload: {
        company_id: params.company_id,
        target_user_id: params.target_user_id,
        before_role: params.before_role,
        after_role: params.after_role,
        changed_by_user_id: params.actor_user_id,
      },
    },
    txOrDb,
  );

export const recordMembershipRemoved = (
  params: {
    actor_user_id: string;
    company_id: string;
    removed_user_id: string;
    role_at_removal: Role;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  recordMembershipsRemoved(
    {
      actor_user_id: params.actor_user_id,
      company_id: params.company_id,
      removed: [{ user_id: params.removed_user_id, role_at_removal: params.role_at_removal }],
    },
    txOrDb,
  );

export const recordInvitationsRevoked = (
  params: {
    actor_user_id: string;
    company_id: string;
    invitation_ids: string[];
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLogs(
    params.invitation_ids.map((invitation_id) => ({
      eventType: "invitation_revoked" as const,
      userId: params.actor_user_id,
      payload: {
        invitation_id,
        company_id: params.company_id,
        revoked_by_user_id: params.actor_user_id,
      },
    })),
    txOrDb,
  );

export const recordMembershipsRemoved = (
  params: {
    actor_user_id: string;
    company_id: string;
    removed: Array<{ user_id: string; role_at_removal: Role }>;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLogs(
    params.removed.map((m) => ({
      eventType: "membership_removed" as const,
      userId: params.actor_user_id,
      payload: {
        company_id: params.company_id,
        removed_user_id: m.user_id,
        removed_by_user_id: params.actor_user_id,
        role_at_removal: m.role_at_removal,
        was_self: params.actor_user_id === m.user_id,
      },
    })),
    txOrDb,
  );

export const recordCompanySwitched = (
  params: {
    actor_user_id: string;
    from_company_id: string | null;
    to_company_id: string;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "company_switched",
      userId: params.actor_user_id,
      payload: {
        from_company_id: params.from_company_id,
        to_company_id: params.to_company_id,
      },
    },
    txOrDb,
  );

export const recordCompanyUpdated = (
  params: {
    actor_user_id: string;
    company_id: string;
    before: { name: string; org_code: OrgCode };
    after: { name: string; org_code: OrgCode };
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "company_updated",
      userId: params.actor_user_id,
      payload: {
        company_id: params.company_id,
        before: params.before,
        after: params.after,
      },
    },
    txOrDb,
  );

export const recordCompanyDeleted = (
  params: {
    actor_user_id: string;
    company_id: string;
    name_at_deletion: string;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "company_deleted",
      userId: params.actor_user_id,
      payload: {
        company_id: params.company_id,
        name_at_deletion: params.name_at_deletion,
        deleted_by_user_id: params.actor_user_id,
      },
    },
    txOrDb,
  );

export const recordOwnershipTransferred = (
  params: {
    actor_user_id: string;
    company_id: string;
    from_user_id: string;
    to_user_id: string;
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "ownership_transferred",
      userId: params.actor_user_id,
      payload: {
        company_id: params.company_id,
        from_user_id: params.from_user_id,
        to_user_id: params.to_user_id,
      },
    },
    txOrDb,
  );
