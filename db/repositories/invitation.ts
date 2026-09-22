import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../client";
import { invitation, type Role } from "../schema";
import type { DbOrTx } from "../transaction";

export const generateInvitationId = (): string => `inv_${nanoid(24)}`;

export const generateInvitationToken = (): string => nanoid(32);

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

// migration 前のデータに大文字が残っている可能性があるため、lower() で比較する。
export async function findActivePendingInvitation(
  companyId: string,
  email: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow | undefined> {
  return txOrDb
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.companyId, companyId),
        sql`lower(${invitation.email}) = lower(${email})`,
        eq(invitation.status, "PENDING"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function listPendingInvitations(
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow[]> {
  return txOrDb
    .select()
    .from(invitation)
    .where(and(eq(invitation.companyId, companyId), eq(invitation.status, "PENDING")));
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
  const now = new Date();
  return txOrDb
    .update(invitation)
    .set({ status: "ACCEPTED", acceptedAt: now, usedAt: now })
    .where(and(eq(invitation.id, id), eq(invitation.status, "PENDING")))
    .returning()
    .then((rows) => rows.at(0));
}

export async function markInvitationRevoked(
  id: string,
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow | undefined> {
  const now = new Date();
  return txOrDb
    .update(invitation)
    .set({ status: "REVOKED", revokedAt: now, usedAt: now })
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

// soft delete 済み company への受諾で所属が復活するのを防ぐ (受諾側のガードと組)。
export async function revokePendingInvitationsOfCompany(
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<InvitationRow[]> {
  const now = new Date();
  return txOrDb
    .update(invitation)
    .set({ status: "REVOKED", revokedAt: now, usedAt: now })
    .where(and(eq(invitation.companyId, companyId), eq(invitation.status, "PENDING")))
    .returning();
}

export function isAcceptable(row: InvitationRow): boolean {
  return row.status === "PENDING" && row.expiresAt.getTime() > Date.now();
}
