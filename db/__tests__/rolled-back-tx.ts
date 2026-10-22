import { TransactionRollbackError } from "drizzle-orm/errors";
import { db } from "../client";
import type { DbTx } from "../transaction";

export const inRolledBackTx = (body: (tx: DbTx) => Promise<void>) =>
  db
    .transaction(async (tx) => {
      await body(tx);
      tx.rollback();
    })
    .catch((e) => {
      if (!(e instanceof TransactionRollbackError)) throw e;
    });
