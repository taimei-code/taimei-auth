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

type Role = SeedInvitationOptions["role"];

// URL.hostname は IPv6 loopback を角括弧付きで返す
const LOCAL_DB_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "auth-postgres"]);

// APP_ENV で判定すると、本番 DATABASE_URL を export したままの手動実行 (APP_ENV 未設定) を通してしまう
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

// email (sign-up 経由の user は id がランダム) と固定 id (user 削除後も残る audit_log) の両方で回収する
async function removeFixtureRows(rows: {
  userSuffixes: string[];
  companySuffixes?: string[];
}): Promise<void> {
  const existing = await readUserIdsByEmails(rows.userSuffixes.map(fixtureEmail));
  const userIds = [...new Set([...existing, ...rows.userSuffixes.map(seededUserId)])];
  await deleteAuditByUserIds(userIds);
  await deleteUsersByIds(userIds);
  // company は membership が restrict のため user の後に消す
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

// 実行中にメンバーが増え (invitation-flow)、招待 fixture が FK で参照するため、件数 assertion・消費・単独の作り直しをしない
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
  // 未設定だと handler が membership の先頭 (行順不定) へ fallback し、削除対象が決まらない
  await seed.setLastUsedCompany(userId, currentCompanyId);
}

const MFA_FIXTURE: FixtureSpec = {
  company: "mfa",
  members: [{ suffix: "mfa", name: "E2E Mfa", role: "OWNER" }],
};

const INVITATION_TOKEN = "e2e-invitation-token";

async function ensureInvitationFixture(): Promise<void> {
  assertLocalDatabase();
  // 破壊より先に検証し、消すだけ消して abort するのを避ける
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

export const consumableFixtures = new Map<string, () => Promise<void>>([
  ["leave", () => ensureFixture(LEAVE_FIXTURE)],
  ["delete", () => ensureFixture(DELETE_FIXTURE)],
  ["delete-multi", ensureDeleteMultiFixture],
  ["invitation", ensureInvitationFixture],
  ["mfa", () => ensureFixture(MFA_FIXTURE)],
]);

// e2e- prefix は spec 実行中に作られる e2e-newbie-* にも一致するため、spec からは呼ばない
export async function resetAllFixtures(): Promise<void> {
  assertLocalDatabase();
  const staleIds = await readUserIdsByEmailPrefix(E2E_PREFIX);
  await deleteAuditByUserIds(staleIds);
  await deleteUsersByIds(staleIds);
  // 連動削除で user 行が消えた seed user の audit と company を固定 id の prefix で回収する
  await seed.cleanup();

  // invitation は main を FK で参照するため最後
  await ensureFixture(MAIN_FIXTURE);
  await ensureFixture(LEAVE_FIXTURE);
  await ensureFixture(DANGER_FIXTURE);
  await ensureFixture(DELETE_FIXTURE);
  await ensureDeleteMultiFixture();
  await ensureFixture(MFA_FIXTURE);
  await ensureInvitationFixture();
}
