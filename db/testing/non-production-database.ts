import { sql } from "drizzle-orm";
import { db } from "../client";
import type { LocalDatabase } from "./local-database";

export type MarkedDatabase = { readonly _tag: "Marked" };

export type NonProductionDatabase = LocalDatabase | MarkedDatabase;

export const requireMarkedDatabase = async (): Promise<MarkedDatabase> => {
  const { rows } = await db.execute<{ marked: boolean }>(
    sql`SELECT to_regclass('public.non_production_database') IS NOT NULL AS marked`,
  );
  if (rows[0]?.marked) return { _tag: "Marked" };
  throw new Error(
    "DB に本番以外の DB の印の表 (public.non_production_database) が無い。本番以外の表と試験の行を書くので、docs/runbook/staging.md の SQL で印を付けた DB に向ける",
  );
};
