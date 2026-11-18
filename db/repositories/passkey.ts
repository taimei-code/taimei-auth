import { and, asc, eq } from "drizzle-orm";
import { db } from "../client";
import { passkey } from "../schema";
import type { DbOrTx } from "../transaction";

export type PasskeyRow = typeof passkey.$inferSelect;

export type NewPasskey = Pick<
  typeof passkey.$inferInsert,
  "id" | "userId" | "credentialId" | "publicKey" | "counter" | "aaguid" | "transports"
>;

export const generatePasskeyId = (): string => crypto.randomUUID();

export async function listPasskeys(userId: string, txOrDb: DbOrTx = db): Promise<PasskeyRow[]> {
  return txOrDb
    .select()
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .orderBy(asc(passkey.createdAt), asc(passkey.id));
}

export async function insertPasskey(
  values: NewPasskey,
  txOrDb: DbOrTx = db,
): Promise<PasskeyRow | undefined> {
  return txOrDb
    .insert(passkey)
    .values(values)
    .onConflictDoNothing({ target: passkey.credentialId })
    .returning()
    .then((rows) => rows.at(0));
}

export async function deletePasskey(
  id: string,
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<Pick<PasskeyRow, "id"> | undefined> {
  return txOrDb
    .delete(passkey)
    .where(and(eq(passkey.id, id), eq(passkey.userId, userId)))
    .returning({ id: passkey.id })
    .then((rows) => rows.at(0));
}
