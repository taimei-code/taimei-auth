import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../client";
import { user } from "../schema";
import type { DbOrTx } from "../transaction";

export type UserRow = typeof user.$inferSelect;
// updateUser が動かしてよい列は handler 側で定めた name / image のみ (広げると更新キーを絞れない)。
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

// session / account 行は db/schema.ts の onDelete: "cascade" で道連れに削除される。
export async function deleteUser(id: string, txOrDb: DbOrTx = db): Promise<UserRow | undefined> {
  return txOrDb
    .delete(user)
    .where(eq(user.id, id))
    .returning()
    .then((rows) => rows.at(0));
}

// column 単独更新を repository に置き src/* からの drizzle 直叩きを避ける (db/CLAUDE.md ルール 1)。
export async function updateUserLastUsedCompany(
  userId: string,
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<void> {
  await txOrDb.update(user).set({ lastUsedCompanyId: companyId }).where(eq(user.id, userId));
}

// ADR-0010 D5: 登録途中放棄 (事業所 0 件アカウント) を回収する TTL sweep の候補抽出。
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

// ADR-0010: company は soft delete (UPDATE) のため ON DELETE SET NULL が発火せず dangling 参照が残る。
// 削除 company を指す全 user を残存 ACTIVE membership (無ければ NULL) に同一 tx で付け替える。
export async function reassignLastUsedCompanyForDeletedCompany(
  companyId: string,
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
    .where(eq(user.lastUsedCompanyId, companyId));
}
