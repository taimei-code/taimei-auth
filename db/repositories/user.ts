import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../client";
import { user } from "../schema";
import type { DbOrTx } from "../transaction";

export type UserRow = typeof user.$inferSelect;
// updateUser が動かしてよい列は handler 側 (proto UpdateUserRequest) で定めた name / image のみ。
// id / createdAt / email まで `Partial<UserInsert>` で広げると repository が更新キーを安全側に絞れない。
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
  // session, account は db/schema.ts の onDelete: "cascade" で自動削除される。
  return txOrDb
    .delete(user)
    .where(eq(user.id, id))
    .returning()
    .then((rows) => rows.at(0));
}

// ADR-009: CreateCompany / SetCurrentCompany handler から呼ばれる column 単独更新。
// repository に置くことで src/* から drizzle-orm 直叩きを避ける (db/CLAUDE.md ルール 1)。
export async function updateUserLastUsedCompany(
  userId: string,
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<void> {
  await txOrDb.update(user).set({ lastUsedCompanyId: companyId }).where(eq(user.id, userId));
}

// ADR-0010 D5: 登録途中放棄 (signup でアカウント作成後、一定時間 事業所を作らなかった 0 件アカウント) を
// 回収する TTL sweep の候補抽出。D2 で通常の orphan は即削除されるため、残るのは新規 signup の放棄分のみ。
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

// ADR-0010 (設計レビュー DA Critique 1): 事業所を soft delete (UPDATE) するため
// last_used_company_id の `ON DELETE SET NULL` が発火せず、削除 company を指す dangling 参照が残る。
// SDK は user.default_company_id (= last_used_company_id) を companyId の権威ソースにするため、
// 削除 company を指す全 user を残存 ACTIVE membership (なければ NULL) に同一 tx で付け替える。
// DeleteCompany フローでは当該 company の membership 物理削除後に呼ぶ前提 (= subquery が削除 company を選ばない)。
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
