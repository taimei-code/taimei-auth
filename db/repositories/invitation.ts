import { and, eq, gt, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../client";
import { type InvitationStatus, invitation, type Role } from "../schema";
import type { DbOrTx } from "../transaction";

export const generateInvitationId = (): string => `inv_${nanoid(24)}`;

export const generateInvitationToken = (): string => nanoid(32);

export const invitationStatusColumns = (status: InvitationStatus, now: Date) => ({
  status,
  acceptedAt: status === "ACCEPTED" ? now : null,
  revokedAt: status === "REVOKED" ? now : null,
  usedAt: status === "PENDING" ? null : now,
});

export const pendingAt = (now: Date): SQL | undefined =>
  and(eq(invitation.status, "PENDING"), gt(invitation.expiresAt, now));

export type InvitationRow = typeof invitation.$inferSelect;
export type { Role };

export async function findInvitationByToken(
  token: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow | undefined> {
  return txOrDb
    .select()
    .from(invitation)
    .where(eq(invitation.token, token))
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function findInvitationById(
  id: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow | undefined> {
  return txOrDb
    .select()
    .from(invitation)
    .where(eq(invitation.id, id))
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function findActivePendingInvitation(
  companyId: string,
  email: string,
  now: Date,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow | undefined> {
  return txOrDb
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.companyId, companyId),
        sql`lower(${invitation.email}) = lower(${email})`,
        pendingAt(now),
      ),
    )
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function listPendingInvitations(
  companyId: string,
  now: Date,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow[]> {
  return txOrDb
    .select()
    .from(invitation)
    .where(and(eq(invitation.companyId, companyId), pendingAt(now)));
}

export async function insertInvitation(
  params: {
    id: string;
    companyId: string;
    email: string;
    role: Role;
    token: string;
    expiresAt: Date;
    invitedByUserId: string;
  },
  txOrDb: DbOrTx = db,
): Promise<InvitationRow> {
  return txOrDb
    .insert(invitation)
    .values({
      id: params.id,
      companyId: params.companyId,
      email: params.email,
      role: params.role,
      token: params.token,
      expiresAt: params.expiresAt,
      status: "PENDING",
      invitedByUserId: params.invitedByUserId,
    })
    .returning()
    .then((rows) => {
      const row = rows.at(0);
      if (!row) throw new Error("invitation INSERT returned no row");
      return row;
    });
}

export async function markInvitationAccepted(
  id: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow | undefined> {
  return txOrDb
    .update(invitation)
    .set(invitationStatusColumns("ACCEPTED", new Date()))
    .where(and(eq(invitation.id, id), eq(invitation.status, "PENDING")))
    .returning()
    .then((rows) => rows.at(0));
}

export async function markInvitationRevoked(
  id: string,
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow | undefined> {
  return txOrDb
    .update(invitation)
    .set(invitationStatusColumns("REVOKED", new Date()))
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.companyId, companyId),
        eq(invitation.status, "PENDING"),
      ),
    )
    .returning()
    .then((rows) => rows.at(0));
}

export async function revokePendingInvitationsOfCompany(
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow[]> {
  return txOrDb
    .update(invitation)
    .set(invitationStatusColumns("REVOKED", new Date()))
    .where(and(eq(invitation.companyId, companyId), eq(invitation.status, "PENDING")))
    .returning();
}
