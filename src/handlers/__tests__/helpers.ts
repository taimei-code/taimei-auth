import { and, asc, eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "@/db/client";
import { generateCompanyId, insertCompany, type OrgCode } from "@/db/repositories/company";
import {
  generateInvitationId,
  generateInvitationToken,
  insertInvitation,
  markInvitationAccepted,
  markInvitationRevoked,
} from "@/db/repositories/invitation";
import { generateMembershipId, insertMembership, type Role } from "@/db/repositories/membership";
import { auditLog, company, invitation, membership, session, user } from "@/db/schema";
import { mountAccountRoutes } from "../../app";
import { auth } from "../../auth";

// account handler / invitation use-case の DB 統合テストで共用する seed / auth stub / cleanup。
// - session 側: auth.api.getSession を monkey-patch して任意 actor に固定する (stubActor / restoreActor)
// - DB 側: prefix 付き ID で行を分離し `createSeedHelpers(prefix)` で prefix ごとに factory を作る
//   (複数 test file を同 DB で並走させても行が交ざらない)
// 実 route を叩くには DB 上の membership 行と `auth.api.getSession` が返す actor の両方が必要
// (RoutingPool 経由の DB は per-request 切替、セッションは module 定数 `requireActor` の内側で解決)。

export const TEST_PREFIX = "mig-test-";

export type StubActor = { id: string; email: string } | null;

let originalGetSession: typeof auth.api.getSession | null = null;
let currentActor: StubActor = null;

// getSession を stub して guard/core.ts の getActor が任意の actor を返すようにする。
// module ロード時に requireActor は `auth.api.getSession` の値を closure captured せず、
// call 時に auth.api.getSession を lookup する ((headers) => auth.api.getSession({ headers }))
// ため実行時に patched 版が読まれる。
export function stubActor(actor: StubActor): void {
  if (!originalGetSession) {
    originalGetSession = auth.api.getSession;
  }
  currentActor = actor;
  auth.api.getSession = (async () => {
    if (currentActor === null) return null;
    return { user: { id: currentActor.id, email: currentActor.email } };
  }) as typeof auth.api.getSession;
}

export function restoreActor(): void {
  if (originalGetSession) {
    auth.api.getSession = originalGetSession;
    originalGetSession = null;
  }
  currentActor = null;
}

// auth-entry-redirect は getSession の前段で getSessionCookie(headers) を通すため、
// stubActor だけでは cookie 不在の早期 next() に落ちて「pass-through が正解」のテストが
// 理由を問わず緑になる。session 分岐を検証するテストは必ずこの header を付与し、
// 「cookie 無し」のケースと分岐理由を分離する (cookie 名は local 環境の非 Secure 版)。
export const SESSION_COOKIE_HEADER = { cookie: "better-auth.session_token=stub-session" };

export type SeededUser = { id: string; email: string };

export type SeededInvitation = { id: string; token: string };

export type SeededInvitationOptions = {
  companyId: string;
  email: string;
  role: Role;
  invitedByUserId: string;
  status?: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt?: Date;
  token?: string;
};

// prefix ごとに seed / cleanup を factory 化する。test file 間で行が交ざらないよう、
// 各 file は自 prefix で helper を作る (`createSeedHelpers("mig-test-")` 等)。
// status!=PENDING の invitation seed は production の markInvitation* primitive を経由し、
// accepted_at / revoked_at / used_at の DB shape を production と一致させる。
export function createSeedHelpers(prefix: string) {
  const cleanup = async (): Promise<void> => {
    await db.delete(auditLog).where(like(auditLog.userId, `${prefix}%`));
    await db.delete(invitation).where(like(invitation.email, `${prefix}%`));
    await db.delete(invitation).where(like(invitation.invitedByUserId, `${prefix}%`));
    await db.delete(session).where(like(session.userId, `${prefix}%`));
    await db.delete(membership).where(like(membership.userId, `${prefix}%`));
    await db.delete(company).where(like(company.name, `${prefix}%`));
    await db.delete(user).where(like(user.id, `${prefix}%`));
  };

  const seedUser = async (
    suffix: string,
    opts?: { lastUsedCompanyId?: string; email?: string; name?: string },
  ): Promise<SeededUser> => {
    const id = `${prefix}u-${suffix}`;
    const email = opts?.email ?? `${prefix}${suffix}@example.com`;
    const name = opts?.name ?? `User ${suffix}`;
    await db.insert(user).values({
      id,
      name,
      email,
      emailVerified: true,
      lastUsedCompanyId: opts?.lastUsedCompanyId ?? null,
    });
    return { id, email };
  };

  const seedCompany = async (suffix: string, orgCode: OrgCode = "PERSONAL"): Promise<string> => {
    const id = generateCompanyId();
    await insertCompany({ id, name: `${prefix}co-${suffix}`, orgCode });
    return id;
  };

  const seedMembership = async (
    userId: string,
    companyId: string,
    role: Role = "MEMBER",
  ): Promise<string> => {
    const id = generateMembershipId();
    await insertMembership({ id, userId, companyId, role });
    return id;
  };

  const seedInvitation = async (opts: SeededInvitationOptions): Promise<SeededInvitation> => {
    const id = generateInvitationId();
    const token = opts.token ?? generateInvitationToken();
    const expiresAt = opts.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
    await insertInvitation({
      id,
      companyId: opts.companyId,
      email: opts.email,
      role: opts.role,
      token,
      expiresAt,
      invitedByUserId: opts.invitedByUserId,
    });
    // ACCEPTED / REVOKED は insertInvitation が PENDING を強制するため primitive で遷移させる。
    // 生 UPDATE でなく repository 経由にする理由: accepted_at / revoked_at / used_at の 3 列を
    // production の状態遷移 (markInvitationAccepted / markInvitationRevoked) と同じ shape で set し、
    // audit / SPA が参照する派生列 (used_at COALESCE) の値が test seed だけ壊れる状況を防ぐ。
    if (opts.status === "ACCEPTED") {
      await markInvitationAccepted(id);
    } else if (opts.status === "REVOKED") {
      await markInvitationRevoked(id, opts.companyId);
    }
    return { id, token };
  };

  return { cleanup, seedUser, seedCompany, seedMembership, seedInvitation };
}

// 後方互換のため既存 handlers 側 call site が touch なしで動くよう TEST_PREFIX 束縛版を
// module-level export で維持する。新規 test file は createSeedHelpers を直接呼ぶこと。
const defaultHelpers = createSeedHelpers(TEST_PREFIX);
export const cleanupTestData = defaultHelpers.cleanup;
export const seedUser = defaultHelpers.seedUser;
export const seedCompany = defaultHelpers.seedCompany;
export const seedMembership = defaultHelpers.seedMembership;
export const seedInvitation = defaultHelpers.seedInvitation;

export function buildTestApp(): Hono {
  const app = new Hono();
  mountAccountRoutes(app);
  return app;
}

export type NormalizedResponse = {
  status: number;
  contentType: string | null;
  body: unknown;
};

// レスポンスを比較可能な JSON 化する。Content-Type と status を明示的に含める
// (fixture の deep-equal 対象がこの 3 点セット)。
export async function normalizeResponse(res: Response): Promise<NormalizedResponse> {
  const contentType = res.headers.get("content-type");
  let body: unknown;
  const text = await res.text();
  if (text.length === 0) {
    body = null;
  } else if (contentType?.includes("application/json")) {
    body = JSON.parse(text);
  } else {
    body = text;
  }
  return { status: res.status, contentType, body };
}

// 対象事業所の membership カウント (テストの副作用検証用)。
export async function membershipCount(companyId: string): Promise<number> {
  const rows = await db.select().from(membership).where(eq(membership.companyId, companyId));
  return rows.length;
}

export async function membershipRoleOf(
  userId: string,
  companyId: string,
): Promise<Role | undefined> {
  const rows = await db
    .select()
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)));
  return rows.at(0)?.role as Role | undefined;
}

// use-case DB 統合テスト全体で共有する audit 行取得。userId + eventType で絞り込み createdAt 昇順で
// 返す。「mutation → audit の発火順 pin」「rollback 経路で audit 非発火」等の contract を各テストで
// 統一的に検証するため、6 test file にコピペされていたローカル定義をここに集約する。
export function auditRowsFor(
  userId: string,
  eventType: string,
): Promise<(typeof auditLog.$inferSelect)[]> {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)))
    .orderBy(asc(auditLog.createdAt));
}
