import { asc } from "drizzle-orm";
import { db } from "../client";
import { company, membership, type Role, user } from "../schema";

const GENERATED_ID_BODY_LENGTH = 24;

const fixedId = (prefix: "cmp" | "mbr", name: string) =>
  `${prefix}_${name.padEnd(GENERATED_ID_BODY_LENGTH, "0")}`;

const FIRST_COMPANY = {
  key: "first",
  id: fixedId("cmp", "dev_company_first"),
  name: "開発用の事業所 1",
};
const SECOND_COMPANY = {
  key: "second",
  id: fixedId("cmp", "dev_company_second"),
  name: "開発用の事業所 2",
};

type DevCompany = typeof FIRST_COMPANY;

const devUser = (key: string, memberships: readonly { company: DevCompany; role: Role }[]) => ({
  id: `dev-account-${key}`,
  name: `開発用 ${key.toUpperCase()}`,
  email: `dev-${key}@example.com`,
  memberships: memberships.map(({ company, role }) => ({
    id: fixedId("mbr", `dev_${key}_${company.key}`),
    companyId: company.id,
    role,
  })),
});

export const DEV_ACCOUNTS = {
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  companies: [FIRST_COMPANY, SECOND_COMPANY],
  users: [
    devUser("owner", [
      { company: FIRST_COMPANY, role: "OWNER" },
      { company: SECOND_COMPANY, role: "OWNER" },
    ]),
    devUser("admin", [
      { company: FIRST_COMPANY, role: "ADMIN" },
      { company: SECOND_COMPANY, role: "MEMBER" },
    ]),
    devUser("member", [{ company: FIRST_COMPANY, role: "MEMBER" }]),
  ],
};

export const seedDevAccounts = () =>
  db.transaction(async (tx) => {
    const { createdAt, companies, users } = DEV_ACCOUNTS;
    await tx
      .insert(company)
      .values(
        companies.map(({ id, name }) => ({
          id,
          name,
          orgCode: "CORPORATE" as const,
          activationStatus: "ACTIVE" as const,
          createdAt,
        })),
      )
      .onConflictDoNothing();
    await tx
      .insert(user)
      .values(
        users.map(({ id, name, email, memberships }, listedOrder) => ({
          id,
          name,
          email,
          emailVerified: true,
          lastUsedCompanyId: memberships[0]?.companyId ?? null,
          createdAt: new Date(createdAt.getTime() + listedOrder * 1000),
        })),
      )
      .onConflictDoNothing();
    await tx
      .insert(membership)
      .values(
        users.flatMap(({ id: userId, memberships }) =>
          memberships.map(({ id, companyId, role }) => ({
            id,
            userId,
            companyId,
            role,
            joinedAt: createdAt,
            createdAt,
          })),
        ),
      )
      .onConflictDoNothing();
  });

export const listAccounts = () =>
  db.query.user.findMany({
    columns: { id: true, name: true, email: true },
    with: {
      memberships: {
        columns: { role: true },
        with: { company: { columns: { name: true, activationStatus: true } } },
      },
    },
    orderBy: [asc(user.createdAt), asc(user.id)],
  });
