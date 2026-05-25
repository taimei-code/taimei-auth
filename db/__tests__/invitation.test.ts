import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { like } from "drizzle-orm";
import { db } from "../client";
import { generateCompanyId, insertCompany } from "../repositories/company";
import {
  findActivePendingInvitation,
  findInvitationByToken,
  generateInvitationId,
  generateInvitationToken,
  insertInvitation,
  isAcceptable,
  listPendingInvitations,
  markInvitationAccepted,
  markInvitationRevoked,
} from "../repositories/invitation";
import { company, invitation, user } from "../schema";

const USER_ID_PREFIX = "inv-test-user-";
const COMPANY_NAME_PREFIX = "inv-test-co-";

async function cleanup() {
  await db.delete(invitation).where(like(invitation.email, "inv-test-%"));
  await db.delete(company).where(like(company.name, `${COMPANY_NAME_PREFIX}%`));
  await db.delete(user).where(like(user.id, `${USER_ID_PREFIX}%`));
}

async function seedInviter() {
  const userId = `${USER_ID_PREFIX}owner`;
  const companyId = generateCompanyId();
  await db.insert(user).values({
    id: userId,
    name: "Inv Owner",
    email: "inv-test-owner@example.com",
    emailVerified: false,
  });
  await insertCompany({ id: companyId, name: `${COMPANY_NAME_PREFIX}main`, orgCode: "CORPORATE" });
  return { userId, companyId };
}

describe("invitation repository", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("generateInvitationToken は 32 char URL-safe", () => {
    expect(generateInvitationToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  test("insert → token で引ける + PENDING / 未期限なら acceptable", async () => {
    const { userId, companyId } = await seedInviter();
    const token = generateInvitationToken();
    const row = await insertInvitation({
      id: generateInvitationId(),
      companyId,
      email: "inv-test-alice@example.com",
      role: "MEMBER",
      token,
      expiresAt: new Date(Date.now() + 3600_000),
      invitedByUserId: userId,
    });
    expect(row.status).toBe("PENDING");

    const found = await findInvitationByToken(token);
    expect(found?.id).toBe(row.id);
    expect(isAcceptable(found as typeof row)).toBe(true);
  });

  test("期限切れ PENDING は acceptable=false (status は PENDING のまま derived expired)", async () => {
    const { userId, companyId } = await seedInviter();
    const row = await insertInvitation({
      id: generateInvitationId(),
      companyId,
      email: "inv-test-expired@example.com",
      role: "MEMBER",
      token: generateInvitationToken(),
      expiresAt: new Date(Date.now() - 1000),
      invitedByUserId: userId,
    });
    expect(row.status).toBe("PENDING");
    expect(isAcceptable(row)).toBe(false);
  });

  test("findActivePendingInvitation は有効 PENDING のみ返す (idempotency 判定)", async () => {
    const { userId, companyId } = await seedInviter();
    await insertInvitation({
      id: generateInvitationId(),
      companyId,
      email: "inv-test-dup@example.com",
      role: "MEMBER",
      token: generateInvitationToken(),
      expiresAt: new Date(Date.now() + 3600_000),
      invitedByUserId: userId,
    });
    const active = await findActivePendingInvitation(companyId, "inv-test-dup@example.com");
    expect(active).toBeDefined();
    const none = await findActivePendingInvitation(companyId, "inv-test-nobody@example.com");
    expect(none).toBeUndefined();
  });

  test("markInvitationAccepted は PENDING のみ更新 (二重 accept で 2 回目 undefined)", async () => {
    const { userId, companyId } = await seedInviter();
    const id = generateInvitationId();
    await insertInvitation({
      id,
      companyId,
      email: "inv-test-accept@example.com",
      role: "MEMBER",
      token: generateInvitationToken(),
      expiresAt: new Date(Date.now() + 3600_000),
      invitedByUserId: userId,
    });
    const first = await markInvitationAccepted(id);
    expect(first?.status).toBe("ACCEPTED");
    const second = await markInvitationAccepted(id);
    expect(second).toBeUndefined();
  });

  test("markInvitationRevoked は PENDING のみ revoke + listPendingInvitations から消える", async () => {
    const { userId, companyId } = await seedInviter();
    const id = generateInvitationId();
    await insertInvitation({
      id,
      companyId,
      email: "inv-test-revoke@example.com",
      role: "ADMIN",
      token: generateInvitationToken(),
      expiresAt: new Date(Date.now() + 3600_000),
      invitedByUserId: userId,
    });
    const before = await listPendingInvitations(companyId);
    expect(before.length).toBe(1);

    const revoked = await markInvitationRevoked(id, companyId);
    expect(revoked?.status).toBe("REVOKED");

    const after = await listPendingInvitations(companyId);
    expect(after.length).toBe(0);

    // 二重 revoke は undefined
    expect(await markInvitationRevoked(id, companyId)).toBeUndefined();
  });
});
