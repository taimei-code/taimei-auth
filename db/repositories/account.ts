import { eq } from "drizzle-orm";
import { db } from "../client";
import { account } from "../schema";

export type AccountRow = typeof account.$inferSelect;

export async function findAccountByUserId(userId: string): Promise<AccountRow | undefined> {
  return db
    .select()
    .from(account)
    .where(eq(account.userId, userId))
    .limit(1)
    .then((rows) => rows.at(0));
}
