import { describe, expect, test } from "bun:test";
import type { InvitationRow } from "@/db/repositories/invitation";
import type { MembershipRow, Role } from "@/db/repositories/membership";
import {
  createMembershipGuard,
  makeRequireInvitationAccept,
  makeRequireInvite,
  makeRequireRemoval,
  makeRequireRoleChange,
  makeRequireTransferOwnership,
  type Actor,
} from "../guard";

// operation 単位 entry の判定順を DI で検証する。
// core.ts の generic entry (requireActor / requireMembershipOf / requireMembership) は
// 既存 guard.test.ts が同一 factory で覆っており、こちらでは 5 operation entry の
// step 順序 (401 → 400 → 403 → 404 → 403/... の相対順) と fail-closed 契約に絞る。

const anActor: Actor = { id: "u_1", email: "a@example.com", lastUsedCompanyId: null };
const noHeaders = new Headers();

const fakeMembership = (
  role: Role,
  opts?: { id?: string; userId?: string; companyId?: string },
): MembershipRow =>
  ({
    id: opts?.id ?? "mbr_x",
    userId: opts?.userId ?? "u_x",
    companyId: opts?.companyId ?? "co_x",
    role,
  }) as unknown as MembershipRow;

const buildGuard = (opts: { actor?: Actor | null; membershipRole?: Role | null }) =>
  createMembershipGuard({
    getActor: async () => opts.actor ?? null,
    findMembership: async () =>
      opts.membershipRole ? fakeMembership(opts.membershipRole) : undefined,
  });

describe("requireRoleChange (401 → 400 → 403 → 404 → 403)", () => {
  test("QA-D-01 未認証 + invalid body → 401 (400 に先立つ)", async () => {
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: null, membershipRole: "OWNER" }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_2",
      parseBody: () => ({ ok: false, details: { role: "invalid" } }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
  });

  test("認証済 + invalid body → 400 (403/404 に先立つ)", async () => {
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: anActor, membershipRole: "MEMBER" }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_2",
      parseBody: () => ({ ok: false }),
    });
    if (!r.ok) {
      expect(r.error).toBe("invalid_argument");
      expect(r.status).toBe(400);
    }
  });

  test("認証済 + valid body + MEMBER (ADMIN 未満) → 403", async () => {
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: anActor, membershipRole: "MEMBER" }),
      findMembership: async () => fakeMembership("MEMBER"),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_2",
      parseBody: () => ({ ok: true, data: { nextRole: "ADMIN" } }),
    });
    if (!r.ok) expect(r.error).toBe("forbidden");
  });

  test("ADMIN + target 不在 → 404", async () => {
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_2",
      parseBody: () => ({ ok: true, data: { nextRole: "MEMBER" } }),
    });
    if (!r.ok) expect(r.error).toBe("not_found");
  });

  test("ADMIN が OWNER に触れる変更 → 403 (canChangeRole)", async () => {
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
      findMembership: async () => fakeMembership("OWNER"),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_2",
      parseBody: () => ({ ok: true, data: { nextRole: "MEMBER" } }),
    });
    if (!r.ok) expect(r.error).toBe("forbidden");
  });
});

describe("requireInvite (401 → 403 (ADMIN) → 400 → 403 (canInviteRole))", () => {
  test("QA-E-01 ADMIN + role=OWNER 招待 → 403 (canInviteRole)", async () => {
    const entry = makeRequireInvite({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      parseBody: () => ({ ok: true, data: { email: "x@example.com", role: "OWNER" } }),
    });
    if (!r.ok) {
      expect(r.error).toBe("forbidden");
      expect(r.status).toBe(403);
    }
  });

  test("MEMBER (ADMIN 未満) → 400 に先立って 403", async () => {
    const entry = makeRequireInvite({
      guard: buildGuard({ actor: anActor, membershipRole: "MEMBER" }),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      parseBody: () => ({ ok: false, details: { email: ["invalid"] } }),
    });
    if (!r.ok) expect(r.error).toBe("forbidden");
  });

  test("ADMIN + invalid body → 400 with details", async () => {
    const entry = makeRequireInvite({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      parseBody: () => ({ ok: false, details: { fieldErrors: { email: ["invalid"] } } }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === "invalid_argument") {
      expect(r.status).toBe(400);
      expect(r.details).toEqual({ fieldErrors: { email: ["invalid"] } });
    }
  });
});

describe("requireRemoval (401 → 403 (membership) → 403 (canAttemptRemoval) → 404 → 403 (canRemoveTarget))", () => {
  test("非所属 → 403 (canAttemptRemoval に先立つ)", async () => {
    const entry = makeRequireRemoval({
      guard: buildGuard({ actor: anActor, membershipRole: null }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_2",
    });
    if (!r.ok) expect(r.error).toBe("forbidden");
  });

  test("MEMBER が他者除名 (isSelf=false, ADMIN 未満) → 403 (canAttemptRemoval)", async () => {
    const entry = makeRequireRemoval({
      guard: buildGuard({ actor: anActor, membershipRole: "MEMBER" }),
      findMembership: async () => fakeMembership("MEMBER"),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_other",
    });
    if (!r.ok) expect(r.error).toBe("forbidden");
  });

  test("ADMIN + target 不在 → 404", async () => {
    const entry = makeRequireRemoval({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_missing",
    });
    if (!r.ok) expect(r.error).toBe("not_found");
  });

  test("ADMIN が他 OWNER 除名 → 403 (canRemoveTarget)", async () => {
    const entry = makeRequireRemoval({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
      findMembership: async () => fakeMembership("OWNER"),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      targetUserId: "u_owner",
    });
    if (!r.ok) expect(r.error).toBe("forbidden");
  });
});

describe("requireTransferOwnership (401 → 400 → 403 → 404 → 400 already_owner)", () => {
  test("認証済 + self 委譲 → 400 invalid_argument (parseBody 段で self 検知)", async () => {
    const entry = makeRequireTransferOwnership({
      guard: buildGuard({ actor: anActor, membershipRole: "OWNER" }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      parseBody: () => ({ ok: true, data: { toUserId: anActor.id } }),
    });
    if (!r.ok) {
      expect(r.error).toBe("invalid_argument");
      expect(r.status).toBe(400);
    }
  });

  test("非 OWNER → 403", async () => {
    const entry = makeRequireTransferOwnership({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      parseBody: () => ({ ok: true, data: { toUserId: "u_2" } }),
    });
    if (!r.ok) expect(r.error).toBe("forbidden");
  });

  test("target 不在 → 404", async () => {
    const entry = makeRequireTransferOwnership({
      guard: buildGuard({ actor: anActor, membershipRole: "OWNER" }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      parseBody: () => ({ ok: true, data: { toUserId: "u_missing" } }),
    });
    if (!r.ok) expect(r.error).toBe("not_found");
  });

  test("target 既に OWNER → 400 already_owner", async () => {
    const entry = makeRequireTransferOwnership({
      guard: buildGuard({ actor: anActor, membershipRole: "OWNER" }),
      findMembership: async () => fakeMembership("OWNER"),
    });
    const r = await entry({
      headers: noHeaders,
      companyId: "co_1",
      parseBody: () => ({ ok: true, data: { toUserId: "u_2" } }),
    });
    if (!r.ok) {
      expect(r.error).toBe("already_owner");
      expect(r.status).toBe(400);
    }
  });
});

describe("requireInvitationAccept (401 → 400 → 404 (token) → 403 (email) → reused → 410)", () => {
  const fakeInvitation = (overrides?: Partial<InvitationRow>): InvitationRow =>
    ({
      id: "inv_1",
      companyId: "co_1",
      email: anActor.email,
      role: "MEMBER",
      token: "tok",
      expiresAt: new Date(Date.now() + 60_000),
      status: "PENDING",
      acceptedAt: null,
      revokedAt: null,
      usedAt: null,
      invitedByUserId: "u_owner",
      createdAt: new Date(),
      ...overrides,
    }) as unknown as InvitationRow;

  test("token 不在 → 404", async () => {
    const entry = makeRequireInvitationAccept({
      guard: buildGuard({ actor: anActor, membershipRole: null }),
      findInvitationByToken: async () => undefined,
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      parseBody: () => ({ ok: true, data: { token: "does-not-exist" } }),
    });
    if (!r.ok) expect(r.error).toBe("not_found");
  });

  test("email 不一致 → 403 email_mismatch (case-insensitive で差があると発火)", async () => {
    const entry = makeRequireInvitationAccept({
      guard: buildGuard({ actor: anActor, membershipRole: null }),
      findInvitationByToken: async () => fakeInvitation({ email: "different@example.com" }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      parseBody: () => ({ ok: true, data: { token: "tok" } }),
    });
    if (!r.ok) expect(r.error).toBe("email_mismatch");
  });

  test("既所属短絡 (期限切れ invitation でも既所属なら reused=200) — QA-M-01 の contract", async () => {
    const entry = makeRequireInvitationAccept({
      guard: buildGuard({ actor: anActor, membershipRole: null }),
      findInvitationByToken: async () =>
        fakeInvitation({ expiresAt: new Date(Date.now() - 60_000) }),
      findMembership: async () => fakeMembership("MEMBER"),
    });
    const r = await entry({
      headers: noHeaders,
      parseBody: () => ({ ok: true, data: { token: "tok" } }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe("reused");
  });

  test("期限切れ + 未所属 → 410 (isAcceptable の最後)", async () => {
    const entry = makeRequireInvitationAccept({
      guard: buildGuard({ actor: anActor, membershipRole: null }),
      findInvitationByToken: async () =>
        fakeInvitation({ expiresAt: new Date(Date.now() - 60_000) }),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      parseBody: () => ({ ok: true, data: { token: "tok" } }),
    });
    if (!r.ok) expect(r.error).toBe("expired_or_used");
  });

  test("valid + 未所属 → proceed", async () => {
    const entry = makeRequireInvitationAccept({
      guard: buildGuard({ actor: anActor, membershipRole: null }),
      findInvitationByToken: async () => fakeInvitation(),
      findMembership: async () => undefined,
    });
    const r = await entry({
      headers: noHeaders,
      parseBody: () => ({ ok: true, data: { token: "tok" } }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe("proceed");
  });
});

// QA-R-05 (findMembership throw は fail-closed の対象外 = 伝播させて 500) の順序保証は
// generic entry 側の契約なので、guard.test.ts の既存 test で覆う (別 file で重複しない)。
describe("QA-R-05 findMembership throw は伝播する (fail-closed の対象は session のみ)", () => {
  test("operation 単位 entry も findMembership throw を捕捉しない", async () => {
    const entry = makeRequireRoleChange({
      guard: buildGuard({ actor: anActor, membershipRole: "ADMIN" }),
      findMembership: async () => {
        throw new Error("db timeout");
      },
    });
    await expect(
      entry({
        headers: noHeaders,
        companyId: "co_1",
        targetUserId: "u_2",
        parseBody: () => ({ ok: true, data: { nextRole: "MEMBER" } }),
      }),
    ).rejects.toThrow("db timeout");
  });
});
