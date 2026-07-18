import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../client";
import { invitation, type Role } from "../schema";
import type { DbOrTx } from "../transaction";

// ADR-009: Stripe 流 prefix `inv_<24chars>` で entity type を log / audit_log 上で即判定可能に。
export const generateInvitationId = (): string => `inv_${nanoid(24)}`;

// accept URL に載せる token。invitation.id とは別 (id は内部参照、token は推測困難な公開 secret)。
export const generateInvitationToken = (): string => nanoid(32);

export type InvitationRow = typeof invitation.$inferSelect;
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";
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

// 同 (company_id, email) の有効な (PENDING かつ未期限) 招待。重複招待の idempotency 判定に使う。
// email は handler 側で lowercase 済だが、migration 前データに大文字が残る可能性に備え lower() 比較で robust に。
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

// accept 時: status=ACCEPTED + accepted_at/used_at を set。既に PENDING でない行は 0 件更新 (= 二重 accept 防御)。
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

// revoke 時: status=REVOKED + revoked_at/used_at を set。PENDING のみ revoke 可能。
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

// ADR-0010: 事業所削除時に当該 company の PENDING 招待を一括 REVOKED 化する。revoked 行を返すので
// 呼び出し側が invitation_revoked audit を残せる。soft-deleted company への招待受諾で membership が
// 再生成され DELETED company に所属が復活するのを防ぐ (受諾側のガードと対で効かせる)。
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

// invitation が accept 可能か (PENDING かつ未期限) を判定する述語。
// expired は status 列ではなく expires_at から導出する (status は pending/accepted/revoked の 3 値のみ)。
export function isAcceptable(row: InvitationRow): boolean {
  return row.status === "PENDING" && row.expiresAt.getTime() > Date.now();
}
