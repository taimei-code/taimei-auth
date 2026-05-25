import { randomUUID } from "node:crypto";
import { db } from "../client";
import { auditLog } from "../schema";
import type { DbOrTx } from "../transaction";

// user の意図ある action のみを記録する (session revoke 等の internal state change は記録対象外)。
// IP / userAgent は session cascade delete でも forensic 可能にするため payload に persist。
// 詳細: CONTEXT.md 'audit log' / 'audit event'
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
        org_code: "PERSONAL" | "CORPORATE";
        created_by_user_id: string;
      };
    }
  | {
      eventType: "company_updated";
      userId: string;
      payload: {
        company_id: string;
        before: { name: string; org_code: "PERSONAL" | "CORPORATE" };
        after: { name: string; org_code: "PERSONAL" | "CORPORATE" };
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
        role: "OWNER" | "ADMIN" | "MEMBER";
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
        role: "OWNER" | "ADMIN" | "MEMBER";
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
      eventType: "membership_removed";
      userId: string;
      payload: {
        company_id: string;
        removed_user_id: string;
        removed_by_user_id: string;
        role_at_removal: "OWNER" | "ADMIN" | "MEMBER";
        was_self: boolean;
      };
    }
  | {
      eventType: "role_changed";
      userId: string;
      payload: {
        company_id: string;
        target_user_id: string;
        before_role: "OWNER" | "ADMIN" | "MEMBER";
        after_role: "OWNER" | "ADMIN" | "MEMBER";
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
  await txOrDb.insert(auditLog).values({
    id: randomUUID(),
    eventType: entry.eventType,
    userId: entry.userId,
    payload: entry.payload,
  });
}

// 型安全な helper を export。call site が event_type / payload の整合性を string で組み立てる事故を防ぐ。
export const recordCompanyCreated = (
  params: {
    actor_user_id: string;
    company_id: string;
    name: string;
    org_code: "PERSONAL" | "CORPORATE";
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
    role: "OWNER" | "ADMIN" | "MEMBER";
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
    role: "OWNER" | "ADMIN" | "MEMBER";
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
  appendAuditLog(
    {
      eventType: "invitation_revoked",
      userId: params.actor_user_id,
      payload: {
        invitation_id: params.invitation_id,
        company_id: params.company_id,
        revoked_by_user_id: params.actor_user_id,
      },
    },
    txOrDb,
  );

export const recordRoleChanged = (
  params: {
    actor_user_id: string;
    company_id: string;
    target_user_id: string;
    before_role: "OWNER" | "ADMIN" | "MEMBER";
    after_role: "OWNER" | "ADMIN" | "MEMBER";
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
    role_at_removal: "OWNER" | "ADMIN" | "MEMBER";
  },
  txOrDb: DbOrTx = db,
): Promise<void> =>
  appendAuditLog(
    {
      eventType: "membership_removed",
      userId: params.actor_user_id,
      payload: {
        company_id: params.company_id,
        removed_user_id: params.removed_user_id,
        removed_by_user_id: params.actor_user_id,
        role_at_removal: params.role_at_removal,
        was_self: params.actor_user_id === params.removed_user_id,
      },
    },
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
