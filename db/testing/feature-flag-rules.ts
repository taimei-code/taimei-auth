import { sql } from "drizzle-orm";
import { db } from "../client";
import type { LocalDatabase } from "./local-database";

type FlagRules = {
  readonly enabled: boolean;
  readonly everyone: boolean;
  readonly companyIds: readonly string[];
};

const selectRules = (flag: string) => sql`
  SELECT enabled, everyone, company_ids AS "companyIds"
  FROM testing_feature_flag_rules WHERE flag = ${flag}`;

export const postgresFlagRulesStore = (_database: LocalDatabase) => ({
  storedIn: "Database" as const,
  read: async (flag: string): Promise<FlagRules | undefined> =>
    (await db.execute<FlagRules>(selectRules(flag))).rows[0],
  update: (flag: string, next: (current: FlagRules | undefined) => FlagRules): Promise<void> =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('testing_feature_flag_rules'), hashtext(${flag}))`,
      );
      const rules = next((await tx.execute<FlagRules>(selectRules(flag))).rows[0]);
      await tx.execute(sql`
        INSERT INTO testing_feature_flag_rules (flag, enabled, everyone, company_ids)
        VALUES (${flag}, ${rules.enabled}, ${rules.everyone}, ${sql.param(rules.companyIds)}::text[])
        ON CONFLICT (flag) DO UPDATE SET
          enabled = excluded.enabled, everyone = excluded.everyone, company_ids = excluded.company_ids`);
    }),
});
