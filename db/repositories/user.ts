import { eq } from "drizzle-orm";
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
