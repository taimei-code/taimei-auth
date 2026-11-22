import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { PASSKEY_LIMIT } from "../enums";
import { passkey, user } from "../schema";
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

export async function findPasskeyByCredentialId(
  credentialId: string,
  txOrDb: DbOrTx = db,
): Promise<PasskeyRow | undefined> {
  return txOrDb
    .select()
    .from(passkey)
    .where(eq(passkey.credentialId, credentialId))
    .then((rows) => rows.at(0));
}

export async function recordPasskeyUse(
  id: string,
  counter: number,
  txOrDb: DbOrTx = db,
): Promise<Pick<PasskeyRow, "id"> | undefined> {
  return txOrDb
    .update(passkey)
    .set({ counter: sql`greatest(${passkey.counter}, ${counter})`, lastUsedAt: new Date() })
    .where(eq(passkey.id, id))
    .returning({ id: passkey.id })
    .then((rows) => rows.at(0));
}

export type PasskeySavingRefusal = "CredentialTaken" | "LimitReached";

export async function insertPasskey(
  values: NewPasskey,
  txOrDb: DbOrTx = db,
): Promise<PasskeyRow | PasskeySavingRefusal> {
  const saved = await txOrDb
    .insert(passkey)
    .select((qb) =>
      qb
        .select({
          id: sql`${values.id}`.as("id"),
          userId: user.id,
          credentialId: sql`${values.credentialId}`.as("credential_id"),
          publicKey: sql`${sql.param(values.publicKey, passkey.publicKey)}`.as("public_key"),
          counter: sql`${values.counter}`.as("counter"),
          aaguid: sql`${values.aaguid}`.as("aaguid"),
          transports: sql`${sql.param(values.transports ?? [], passkey.transports)}`.as(
            "transports",
          ),
          createdAt: sql`now()`.as("created_at"),
          lastUsedAt: sql`null`.as("last_used_at"),
        })
        .from(user)
        .where(
          and(
            eq(user.id, values.userId),
            sql`(select count(*) from ${passkey} where ${passkey.userId} = ${values.userId}) < ${PASSKEY_LIMIT}`,
          ),
        ),
    )
    .onConflictDoNothing({ target: passkey.credentialId })
    .returning()
    .then((rows) => rows.at(0));
  if (saved !== undefined) return saved;
  const taken = await findPasskeyByCredentialId(values.credentialId, txOrDb);
  return taken === undefined ? "LimitReached" : "CredentialTaken";
}

export async function deletePasskey(
  id: string,
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<Pick<PasskeyRow, "id" | "aaguid"> | undefined> {
  return txOrDb
    .delete(passkey)
    .where(and(eq(passkey.id, id), eq(passkey.userId, userId)))
    .returning({ id: passkey.id, aaguid: passkey.aaguid })
    .then((rows) => rows.at(0));
}
