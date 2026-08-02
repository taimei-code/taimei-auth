import { inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, company, user } from "@/db/schema";
import { generateCompanyId, insertCompany } from "@/db/repositories/company";
import { generateInvitationId, insertInvitation } from "@/db/repositories/invitation";
import { generateMembershipId, insertMembership, type Role } from "@/db/repositories/membership";

// e2e spec が前提にする固定ユーザーと事業所を冪等に作り直す。
// 実行タイミングは e2e サーバ起動前 (start-server.sh)。
// cleanup は email / 事業所名の e2e- prefix で行う — sign-up flow が better-auth 経由で
// 作る user は id がランダムなため、id prefix では回収できない。
// FK: user 削除で session / membership / invitation は cascade、membership が残る company は
// restrict のため user → company の順で消す。

const EMAIL_LIKE = "e2e-%";
const COMPANY_LIKE = "e2e-co-%";

const staleUsers = await db.select({ id: user.id }).from(user).where(like(user.email, EMAIL_LIKE));
const staleIds = staleUsers.map((u) => u.id);
if (staleIds.length > 0) {
  await db.delete(auditLog).where(inArray(auditLog.userId, staleIds));
  await db.delete(user).where(inArray(user.id, staleIds));
}
// company-delete flow が消した seed user は user 行が残らず staleIds に入らないため、
// その audit だけ固定 id prefix で回収する
await db.delete(auditLog).where(like(auditLog.userId, "e2e-u-%"));
await db.delete(company).where(like(company.name, COMPANY_LIKE));

const seedUser = async (suffix: string, name: string): Promise<string> => {
  const id = `e2e-u-${suffix}`;
  await db.insert(user).values({
    id,
    name,
    email: `e2e-${suffix}@example.com`,
    emailVerified: true,
  });
  return id;
};

const seedCompany = async (suffix: string): Promise<string> => {
  const id = generateCompanyId();
  await insertCompany({ id, name: `e2e-co-${suffix}`, orgCode: "PERSONAL" });
  return id;
};

const seedMembership = async (userId: string, companyId: string, role: Role): Promise<void> => {
  await insertMembership({ id: generateMembershipId(), userId, companyId, role });
};

// sign-in flow + members 画面用: OWNER / ADMIN / MEMBER が同居する事業所
const signinUserId = await seedUser("signin", "E2E SignIn");
const memberUserId = await seedUser("member", "E2E Member");
const adminUserId = await seedUser("admin", "E2E Admin");
const mainCompanyId = await seedCompany("main");
await seedMembership(signinUserId, mainCompanyId, "OWNER");
await seedMembership(memberUserId, mainCompanyId, "MEMBER");
await seedMembership(adminUserId, mainCompanyId, "ADMIN");

// company-leave flow 用: OWNER が別にいる事業所だけに所属する MEMBER
// (最後の所属から抜けると orphan としてアカウント連動削除される状態)
const leaverUserId = await seedUser("leaver", "E2E Leaver");
await seedMembership(leaverUserId, mainCompanyId, "MEMBER");

// danger-zone 用: 唯一の OWNER (退会が PRECONDITION_FAILED で弾かれる状態)
const dangerUserId = await seedUser("danger", "E2E Danger");
const dangerCompanyId = await seedCompany("danger");
await seedMembership(dangerUserId, dangerCompanyId, "OWNER");

// company-delete flow 用: 唯一 OWNER + 単一事業所 (最後の事業所削除でアカウント連動削除される状態)
const deleteUserId = await seedUser("delete", "E2E Delete");
const deleteCompanyId = await seedCompany("delete");
await seedMembership(deleteUserId, deleteCompanyId, "OWNER");

// invitation-flow 用: e2e-invitee 宛の PENDING 招待 (invitee の user 行はまだ無い。
// 招待行は invitedByUserId の FK cascade で毎回の user 掃除と一緒に消え、ここで作り直す)
await insertInvitation({
  id: generateInvitationId(),
  companyId: mainCompanyId,
  email: "e2e-invitee@example.com",
  role: "MEMBER",
  token: "e2e-invitation-token",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  invitedByUserId: signinUserId,
});

console.log("[e2e-seed] done");
process.exit(0);
