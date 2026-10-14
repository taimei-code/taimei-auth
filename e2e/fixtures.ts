import {
  deleteAuditByUserIds,
  deleteCompaniesByNames,
  deleteInvitationByToken,
  deleteUsersByIds,
} from "@/db/testing/cleanup";
import {
  readCompanyIdsByName,
  readUser,
  readUserIdsByEmailPrefix,
  readUserIdsByEmails,
} from "@/db/testing/read";
import { createSeed, ids, type SeedInvitationOptions } from "@/db/testing/seed";
import type { ConsumableFixture } from "./fixture-names";

type Role = SeedInvitationOptions["role"];

const LOCAL_DB_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "auth-postgres"]);

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL;
  const hostname = url && URL.canParse(url) ? new URL(url).hostname : null;
  if (hostname === null || !LOCAL_DB_HOSTNAMES.has(hostname)) {
    console.error(
      `[e2e-seed] abort: DATABASE_URL の host "${hostname ?? "(unset or unparsable)"}" はローカル DB (${[...LOCAL_DB_HOSTNAMES].join(" / ")}) ではない。e2e seed は e2e- prefix の user / company を削除するため実行しない`,
    );
    process.exit(1);
  }
}

const E2E_PREFIX = "e2e-";
const fixtureIds = ids(E2E_PREFIX);
const seed = createSeed(E2E_PREFIX);
const fixtureEmail = fixtureIds.email;
const seededUserId = fixtureIds.userId;
const fixtureCompanyName = fixtureIds.companyName;

const seedUser = (suffix: string, name: string, lastUsedCompanyId?: string): Promise<string> =>
  seed.seedUser(suffix, { name, lastUsedCompanyId }).then((u) => u.id);

const seedCompany = (suffix: string): Promise<string> => seed.seedCompany(suffix);

const seedMembership = (userId: string, companyId: string, role: Role): Promise<void> =>
  seed.seedMembership(userId, companyId, role).then(() => undefined);

async function removeFixtureRows(rows: {
  userSuffixes: string[];
  companySuffixes?: string[];
}): Promise<void> {
  const existing = await readUserIdsByEmails(rows.userSuffixes.map(fixtureEmail));
  const userIds = [...new Set([...existing, ...rows.userSuffixes.map(seededUserId)])];
  await deleteAuditByUserIds(userIds);
  await deleteUsersByIds(userIds);
  if (rows.companySuffixes !== undefined) {
    await deleteCompaniesByNames(rows.companySuffixes.map(fixtureCompanyName));
  }
}

type FixtureSpec = {
  company: string;
  members: { suffix: string; name: string; role: Role }[];
};

async function ensureFixture(spec: FixtureSpec): Promise<void> {
  assertLocalDatabase();
  await removeFixtureRows({
    userSuffixes: spec.members.map((m) => m.suffix),
    companySuffixes: [spec.company],
  });
  const companyId = await seedCompany(spec.company);
  for (const m of spec.members) {
    await seedMembership(await seedUser(m.suffix, m.name, companyId), companyId, m.role);
  }
}

const MAIN_FIXTURE: FixtureSpec = {
  company: "main",
  members: [
    { suffix: "signin", name: "E2E SignIn", role: "OWNER" },
    { suffix: "member", name: "E2E Member", role: "MEMBER" },
    { suffix: "admin", name: "E2E Admin", role: "ADMIN" },
  ],
};

const LEAVE_FIXTURE: FixtureSpec = {
  company: "leave",
  members: [
    { suffix: "leave-owner", name: "E2E LeaveOwner", role: "OWNER" },
    { suffix: "leaver", name: "E2E Leaver", role: "MEMBER" },
  ],
};

const DANGER_FIXTURE: FixtureSpec = {
  company: "danger",
  members: [{ suffix: "danger", name: "E2E Danger", role: "OWNER" }],
};

const WITHDRAW_FIXTURE: FixtureSpec = {
  company: "withdraw",
  members: [
    { suffix: "withdraw", name: "E2E Withdraw", role: "OWNER" },
    { suffix: "withdraw-co-owner", name: "E2E WithdrawCoOwner", role: "OWNER" },
  ],
};

const DELETE_FIXTURE: FixtureSpec = {
  company: "delete",
  members: [{ suffix: "delete", name: "E2E Delete", role: "OWNER" }],
};

const DELETE_MULTI_USER = "delete-multi";
const DELETE_MULTI_CURRENT_COMPANY = "delete-multi-current";
const DELETE_MULTI_OTHER_COMPANY = "delete-multi-other";

async function ensureDeleteMultiFixture(): Promise<void> {
  assertLocalDatabase();
  await removeFixtureRows({
    userSuffixes: [DELETE_MULTI_USER],
    companySuffixes: [DELETE_MULTI_CURRENT_COMPANY, DELETE_MULTI_OTHER_COMPANY],
  });
  const userId = await seedUser(DELETE_MULTI_USER, "E2E DeleteMulti");
  const currentCompanyId = await seedCompany(DELETE_MULTI_CURRENT_COMPANY);
  await seedMembership(userId, currentCompanyId, "OWNER");
  await seedMembership(userId, await seedCompany(DELETE_MULTI_OTHER_COMPANY), "OWNER");
  await seed.setLastUsedCompany(userId, currentCompanyId);
}

const SWITCH_USER = "switch";
const SWITCH_COMPANY_A = "switch-a";
const SWITCH_COMPANY_B = "switch-b";
const COMPANIES_CREATED_BY_SPECS = ["switch-added", "switch-b-renamed"];

async function ensureSwitchFixture(): Promise<void> {
  assertLocalDatabase();
  await removeFixtureRows({
    userSuffixes: [SWITCH_USER, "switch-a-mate", "switch-b-mate"],
    companySuffixes: [SWITCH_COMPANY_A, SWITCH_COMPANY_B, ...COMPANIES_CREATED_BY_SPECS],
  });
  const userId = await seedUser(SWITCH_USER, "E2E Switch");
  const companyA = await seedCompany(SWITCH_COMPANY_A);
  const companyB = await seedCompany(SWITCH_COMPANY_B);
  await seedMembership(userId, companyA, "OWNER");
  await seedMembership(userId, companyB, "OWNER");
  await seedMembership(
    await seedUser("switch-a-mate", "E2E SwitchAMate", companyA),
    companyA,
    "MEMBER",
  );
  await seedMembership(
    await seedUser("switch-b-mate", "E2E SwitchBMate", companyB),
    companyB,
    "MEMBER",
  );
  await seed.setLastUsedCompany(userId, companyA);
}

const MFA_FIXTURE: FixtureSpec = {
  company: "mfa",
  members: [{ suffix: "mfa", name: "E2E Mfa", role: "OWNER" }],
};

const INVITATION_TOKEN = "e2e-invitation-token";

async function ensureInvitationFixture(): Promise<void> {
  assertLocalDatabase();
  const main = await findTheMainCompany();
  await removeFixtureRows({ userSuffixes: ["invitee"] });
  await deleteInvitationByToken(INVITATION_TOKEN);
  await seed.seedInvitation({
    companyId: main.companyId,
    email: fixtureEmail("invitee"),
    role: "MEMBER",
    token: INVITATION_TOKEN,
    invitedByUserId: main.invitedByUserId,
  });
}

async function findTheMainCompany(): Promise<{ companyId: string; invitedByUserId: string }> {
  const [companies, inviter] = await Promise.all([
    readCompanyIdsByName(fixtureCompanyName("main")),
    readUser(seededUserId("signin")),
  ]);
  if (companies.length !== 1 || !inviter) {
    console.error(
      `[e2e-seed] abort: main fixture が不整合 (e2e-co-main: ${companies.length} 件 / e2e-u-signin: ${inviter ? 1 : 0} 件)。全体 seed (bun run e2e/seed.ts) を先に実行すること`,
    );
    process.exit(1);
  }
  return { companyId: companies[0], invitedByUserId: inviter.id };
}

export const consumableFixtures: Record<ConsumableFixture, () => Promise<void>> = {
  leave: () => ensureFixture(LEAVE_FIXTURE),
  delete: () => ensureFixture(DELETE_FIXTURE),
  withdraw: () => ensureFixture(WITHDRAW_FIXTURE),
  "delete-multi": ensureDeleteMultiFixture,
  invitation: ensureInvitationFixture,
  mfa: () => ensureFixture(MFA_FIXTURE),
  switch: ensureSwitchFixture,
};

export async function resetAllFixtures(): Promise<void> {
  assertLocalDatabase();
  const staleIds = await readUserIdsByEmailPrefix(E2E_PREFIX);
  await deleteAuditByUserIds(staleIds);
  await deleteUsersByIds(staleIds);
  await seed.cleanup();

  await ensureFixture(MAIN_FIXTURE);
  await ensureFixture(LEAVE_FIXTURE);
  await ensureFixture(DANGER_FIXTURE);
  await ensureFixture(DELETE_FIXTURE);
  await ensureFixture(WITHDRAW_FIXTURE);
  await ensureDeleteMultiFixture();
  await ensureFixture(MFA_FIXTURE);
  await ensureSwitchFixture();
  await ensureInvitationFixture();
}
