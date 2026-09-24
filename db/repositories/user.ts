import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../client";
import { user } from "../schema";
import type { DbOrTx } from "../transaction";

export type UserRow = typeof user.$inferSelect;
type UserUpdates = Partial<Pick<typeof user.$inferInsert, "name" | "image">>;

export async function findUserById(id: string): Promise<UserRow | undefined> {
  return db
    .select()
    .from(user)
    .where(eq(user.id, id))
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  return db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function updateUser(id: string, updates: UserUpdates): Promise<UserRow | undefined> {
  return db
    .update(user)
    .set(updates)
    .where(eq(user.id, id))
    .returning()
    .then((rows) => rows.at(0));
}

export async function deleteUser(id: string, txOrDb: DbOrTx = db): Promise<UserRow | undefined> {
  return txOrDb
    .delete(user)
    .where(eq(user.id, id))
    .returning()
    .then((rows) => rows.at(0));
}

export async function updateUserLastUsedCompany(
  userId: string,
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<void> {
  await txOrDb.update(user).set({ lastUsedCompanyId: companyId }).where(eq(user.id, userId));
}

export async function findAbandonedSignupUserIds(
  olderThan: Date,
  txOrDb: DbOrTx = db,
): Promise<string[]> {
  const rows = await txOrDb
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        lt(user.createdAt, olderThan),
        sql`NOT EXISTS (
          SELECT 1 FROM membership m
          JOIN company c ON c.id = m.company_id
          WHERE m.user_id = ${user.id} AND c.activation_status = 'ACTIVE'
        )`,
      ),
    );
  return rows.map((r) => r.id);
}

export async function reassignLastUsedCompanyAfterLeaving(
  companyId: string,
  userIds: readonly string[],
  txOrDb: DbOrTx = db,
): Promise<void> {
  await txOrDb
    .update(user)
    .set({
      lastUsedCompanyId: sql`(
        SELECT m.company_id FROM membership m
        JOIN company c ON c.id = m.company_id
        WHERE m.user_id = ${user.id} AND c.activation_status = 'ACTIVE'
        LIMIT 1
      )`,
    })
    .where(and(inArray(user.id, [...userIds]), eq(user.lastUsedCompanyId, companyId)));
}
