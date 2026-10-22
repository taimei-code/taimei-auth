import { expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { applyManualSql } from "../migrate-manual";
import { company, membership, user } from "../schema";
import type { DbTx } from "../transaction";
import { inRolledBackTx } from "./rolled-back-tx";

const signupInProgressUserId = "manualsql-test-u-signup";

const companyCount = async (tx: DbTx) => (await tx.select({ n: count() }).from(company))[0]?.n;

test("drizzle/manual/ を流しても、新規登録の途中で所属の無い利用者に所属・現在の事業所・事業所を作らない", () =>
  inRolledBackTx(async (tx) => {
    await tx.insert(user).values({
      id: signupInProgressUserId,
      name: "Signup In Progress",
      email: "manualsql-test-signup@example.com",
    });
    const companiesBefore = await companyCount(tx);

    await applyManualSql(tx);

    const memberships = await tx
      .select({ n: count() })
      .from(membership)
      .where(eq(membership.userId, signupInProgressUserId));
    const users = await tx
      .select({ lastUsedCompanyId: user.lastUsedCompanyId })
      .from(user)
      .where(eq(user.id, signupInProgressUserId));
    expect(memberships[0]?.n).toBe(0);
    expect(users[0]?.lastUsedCompanyId).toBeNull();
    expect(await companyCount(tx)).toBe(companiesBefore);
  }));
