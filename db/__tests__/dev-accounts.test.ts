import { beforeAll, describe, expect, test } from "bun:test";
import { COMPANY_ID_PATTERN, isJustSignedUp } from "@taimei-code/auth-client";
import { count, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { auditLog, company, membership, user } from "../schema";
import { deleteUsersByIds } from "../testing/cleanup";
import {
  addBrowserAccount,
  DEV_ACCOUNTS,
  listChoosableAccounts,
  seedDevAccounts,
} from "../testing/dev-accounts";
import { readCompany, readMemberships, readUser } from "../testing/read";
import { requireLocalDatabase } from "../testing/local-database";
import { prepareNonProductionTables } from "../testing/non-production-tables";

const devUserIds = DEV_ACCOUNTS.users.map((devUser) => devUser.id);
const devCompanyIds = DEV_ACCOUNTS.companies.map((devCompany) => devCompany.id);

const sortedIds = (rows: readonly { id: string }[]) => rows.map((row) => row.id).sort();

const devRows = async () => ({
  users: sortedIds(await db.select({ id: user.id }).from(user).where(inArray(user.id, devUserIds))),
  companies: sortedIds(
    await db.select({ id: company.id }).from(company).where(inArray(company.id, devCompanyIds)),
  ),
  memberships: sortedIds(
    await db
      .select({ id: membership.id })
      .from(membership)
      .where(inArray(membership.userId, devUserIds)),
  ),
});

const auditCountOfDevUsers = async () =>
  (await db.select({ n: count() }).from(auditLog).where(inArray(auditLog.userId, devUserIds)))[0]
    ?.n;

const [owner, admin, member] = DEV_ACCOUNTS.users;
const [firstCompany] = DEV_ACCOUNTS.companies;
if (!owner || !admin || !member || !firstCompany) {
  throw new Error("DEV_ACCOUNTS lacks the owner, admin, member or the first company");
}

beforeAll(() => prepareNonProductionTables(requireLocalDatabase(process.env.DATABASE_URL)));

describe("開発用アカウントは、何度起動しても重複せず、利用者と事業所の id が変わらない", () => {
  test("seed をもう一度走らせても、開発用の利用者・事業所・所属の id の集合は変わらない", async () => {
    const before = await devRows();

    await seedDevAccounts();

    expect(await devRows()).toEqual(before);
    expect(before).toEqual({
      users: [...devUserIds].sort(),
      companies: [...devCompanyIds].sort(),
      memberships: DEV_ACCOUNTS.users
        .flatMap((devUser) => devUser.memberships.map((m) => m.id))
        .sort(),
    });
  });

  test("開発用の事業所の id は、consumer が受け取る事業所 id の形に合う", () => {
    for (const id of devCompanyIds) expect(id).toMatch(COMPANY_ID_PATTERN);
  });

  test("開発用アカウントは OWNER・ADMIN・MEMBER の所属をそろえ、2 つ以上の事業所に所属する人がいる", () => {
    const memberships = DEV_ACCOUNTS.users.flatMap((devUser) => devUser.memberships);

    expect(new Set(memberships.map((m) => m.role))).toEqual(new Set(["OWNER", "ADMIN", "MEMBER"]));
    expect(DEV_ACCOUNTS.users.some((devUser) => devUser.memberships.length >= 2)).toBe(true);
  });

  test("開発用アカウントは全員が所属を持つので、所属の無い利用者に事業所を作る起動の時の SQL の対象にならない", async () => {
    for (const id of devUserIds) expect((await readMemberships(id)).length).toBeGreaterThan(0);
  });

  test("開発用アカウントは、新規登録の直後と判定されない", async () => {
    for (const id of devUserIds) {
      const row = await readUser(id);
      if (!row) throw new Error(`dev account ${id} is missing`);
      const createdAt = row.createdAt.toISOString();
      expect(
        isJustSignedUp({
          user: {
            id,
            name: row.name,
            email: row.email,
            emailVerified: true,
            createdAt,
            updatedAt: createdAt,
          },
          session: { id: "s", expiresAt: "", kind: "user" },
        }),
      ).toBe(false);
    }
  });

  test("seed は audit log に行を足さない", async () => {
    const before = await auditCountOfDevUsers();

    await seedDevAccounts();

    expect(await auditCountOfDevUsers()).toBe(before);
  });
});

describe("一覧の並び", () => {
  test("一覧は開発用アカウントを OWNER・ADMIN・MEMBER の順に並べる", async () => {
    await deleteUsersByIds(devUserIds);
    await seedDevAccounts();

    const listedDevIds = (await listChoosableAccounts(undefined))
      .map((account) => account.id)
      .filter((id) => devUserIds.includes(id));

    expect(listedDevIds).toEqual(devUserIds);
  });
});

describe("起動のたびに、開発用アカウントの無い行だけを足す", () => {
  test("消した所属は、次の seed で同じ id で戻る", async () => {
    const [removed] = member.memberships;
    if (!removed) throw new Error("the dev member has no membership");
    await db.delete(membership).where(eq(membership.id, removed.id));

    await seedDevAccounts();

    expect((await readMemberships(member.id)).map((m) => m.id)).toEqual([removed.id]);
  });

  test("削除した開発用の事業所は、seed の後も削除済みのまま", async () => {
    await db
      .update(company)
      .set({ activationStatus: "DELETED" })
      .where(eq(company.id, firstCompany.id));
    try {
      await seedDevAccounts();

      expect((await readCompany(firstCompany.id))?.activationStatus).toBe("DELETED");
    } finally {
      await db
        .update(company)
        .set({ activationStatus: "ACTIVE" })
        .where(eq(company.id, firstCompany.id));
    }
  });
});

describe("browser ごとの候補", () => {
  test("削除済みの利用者を browser の鍵に結びつけても失敗せず、候補に足さない", async () => {
    const browserKey = crypto.randomUUID();

    await addBrowserAccount(browserKey, `deleted-${crypto.randomUUID()}`);

    expect(sortedIds(await listChoosableAccounts(browserKey))).toEqual([...devUserIds].sort());
  });
});
