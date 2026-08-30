import { db } from "./client";

// src/* から @/db/client を直接 import できない (biome) ため、tx scope を渡せる関数だけを露出する。
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | DbTx;

export function runInTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
