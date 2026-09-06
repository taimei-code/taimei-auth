import { beforeEach, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { appendAuditLog, recordCompanyCreated } from "../repositories/audit-log";
import { revokeAllSessionsForUser } from "../repositories/session";
import { deleteUser as deleteUserRepo } from "../repositories/user";
import { auditLog, session, user } from "../schema";
import { runInTransaction } from "../transaction";

const testUserId = "test-audit-user";

describe("audit log repository", () => {
  beforeEach(async () => {
    await db.delete(auditLog).where(eq(auditLog.userId, testUserId));
  });

  test("sign_in event を 1 行追加 + payload に method / ip / userAgent 含む", async () => {
    await appendAuditLog({
      eventType: "sign_in",
      userId: testUserId,
      payload: { method: "magic_link", ip: "1.2.3.4", userAgent: "test/1.0" },
    });

    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, testUserId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.eventType).toBe("sign_in");
    expect(rows[0]?.payload).toEqual({
      method: "magic_link",
      ip: "1.2.3.4",
      userAgent: "test/1.0",
    });
  });

  test("sign_out event を 1 行追加 + payload に ip / userAgent 含む", async () => {
    await appendAuditLog({
      eventType: "sign_out",
      userId: testUserId,
      payload: { ip: "1.2.3.4", userAgent: "test/1.0" },
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, testUserId));
    expect(rows[0]?.eventType).toBe("sign_out");
  });

  test("account_delete event を 1 行追加 + payload は空オブジェクト", async () => {
    await appendAuditLog({ eventType: "account_delete", userId: testUserId, payload: {} });
    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, testUserId));
    expect(rows[0]?.eventType).toBe("account_delete");
    expect(rows[0]?.payload).toEqual({});
  });

  // MFA の有効化・無効化は「乗っ取り犯による勝手な操作」を本人が後から辿れる唯一の記録なので、
  // event_type 2 種と payload の形が union に載っていること自体が前提条件になる。
  test("QA-M-01 mfa_enabled / mfa_disabled が union に載り 1 行ずつ追加される", async () => {
    await appendAuditLog({
      eventType: "mfa_enabled",
      userId: testUserId,
      payload: { ip: "1.2.3.4", userAgent: "test/1.0" },
    });
    await appendAuditLog({
      eventType: "mfa_disabled",
      userId: testUserId,
      payload: { ip: null, userAgent: "management/disable-user-mfa" },
    });

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.userId, testUserId))
      .orderBy(asc(auditLog.createdAt));
    expect(rows.map((row) => row.eventType)).toEqual(["mfa_enabled", "mfa_disabled"]);
    // secret / リカバリーコード / 残数は載せない (監査ログ閲覧を第二要素の漏洩経路にしない)。
    expect(rows[0]?.payload).toEqual({ ip: "1.2.3.4", userAgent: "test/1.0" });
    // ip が null を取れるのは、リクエストを持たない運用救済スクリプト経路があるため。
    expect(rows[1]?.payload).toEqual({ ip: null, userAgent: "management/disable-user-mfa" });
  });

  test("recordCompanyCreated helper は event_type + payload 整合性を強制", async () => {
    await recordCompanyCreated({
      actor_user_id: testUserId,
      company_id: "cmp_xxxxxxxxxxxxxxxxxxxxxxxx",
      name: "テスト事業所",
      org_code: "PERSONAL",
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, testUserId));
    expect(rows[0]?.eventType).toBe("company_created");
    expect(rows[0]?.payload).toEqual({
      company_id: "cmp_xxxxxxxxxxxxxxxxxxxxxxxx",
      name: "テスト事業所",
      org_code: "PERSONAL",
      created_by_user_id: testUserId,
    });
  });
});

describe("audit log survives cascade delete (no FK on user_id)", () => {
  const txUserId = "test-audit-tx-user";
  const txSessionId = "test-audit-tx-session";

  beforeEach(async () => {
    await db.delete(auditLog).where(eq(auditLog.userId, txUserId));
    await db.delete(session).where(eq(session.id, txSessionId));
    await db.delete(user).where(eq(user.id, txUserId));
    await db.insert(user).values({
      id: txUserId,
      name: "AuditTx",
      email: "audit-tx-test@example.com",
      emailVerified: false,
    });
    await db.insert(session).values({
      id: txSessionId,
      userId: txUserId,
      token: "audit-tx-tok",
      expiresAt: new Date(Date.now() + 86400000),
    });
  });

  test("audit → revoke → delete を tx で atomic 実行、audit_log は user delete 後も残存", async () => {
    await runInTransaction(async (tx) => {
      await appendAuditLog({ eventType: "account_delete", userId: txUserId, payload: {} }, tx);
      await revokeAllSessionsForUser(txUserId, tx);
      return deleteUserRepo(txUserId, tx);
    });

    const users = await db.select().from(user).where(eq(user.id, txUserId));
    expect(users.length).toBe(0);
    const sessions = await db.select().from(session).where(eq(session.id, txSessionId));
    expect(sessions.length).toBe(0);
    const audits = await db.select().from(auditLog).where(eq(auditLog.userId, txUserId));
    expect(audits.length).toBe(1);
    expect(audits[0]?.eventType).toBe("account_delete");
  });
});
