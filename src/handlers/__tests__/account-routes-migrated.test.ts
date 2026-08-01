import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { db } from "@/db/client";
import { auditLog, invitation, membership } from "@/db/schema";
import { connectRedis } from "../../redis";
import {
  buildTestApp,
  cleanupTestData,
  membershipRoleOf,
  normalizeResponse,
  restoreActor,
  seedCompany,
  seedInvitation,
  seedMembership,
  seedUser,
  stubActor,
  TEST_PREFIX,
  type NormalizedResponse,
} from "./helpers";

// account handler 群の HTTP response (status / body / Content-Type) が Guard 層完成の refactor で
// 崩れないことを固定する。初回実行 (fixture 未存在) では現行 handler の response を
// __fixtures__/expected/*.json に書き出し、以後は deep-equal で assert する。fixture が commit されると
// migration 後の run では純粋な assertion として振る舞う。fixture のリセットは disk 上のファイル削除で行う。
//
// テスト対象 QA-ID:
// - QA-H-02 / QA-H-03 / QA-H-04 (成功 body deep-equal)
// - QA-E-01 (#104: ADMIN が role=OWNER 招待 → 403)
// - QA-E-02 (14 route error 文字列 × status snapshot)
// - QA-E-03 (details 付き 400 の 3 route)
// - QA-D-01 (401 が 400/403/404 に優先)
// - QA-D-02 (期限切れ cookie fail-closed 401)
// - QA-M-03 / QA-M-08 (Content-Type)
// - QA-R-06 (envelope 1 行化した route も既存 response 契約を維持)

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "expected");

function loadOrCapture(name: string, actual: NormalizedResponse): NormalizedResponse {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, `${name}.json`);
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    return actual;
  }
  return JSON.parse(readFileSync(path, "utf8")) as NormalizedResponse;
}

// scenario の生成過程で作られる ID は random (companyId 等) のため、fixture 化する前に
// stable な placeholder に置き換える。生成 ID の桁数は保存しない (deep-equal を安定させるため)。
function normalizeIds(input: unknown, replacements: Record<string, string>): unknown {
  const json = JSON.stringify(input);
  let out = json;
  for (const [original, placeholder] of Object.entries(replacements)) {
    out = out.split(JSON.stringify(original).slice(1, -1)).join(placeholder);
  }
  return JSON.parse(out) as unknown;
}

function normalizeTimestamps(input: unknown): unknown {
  const json = JSON.stringify(input);
  const out = json.replace(/"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z"/g, '"__TIMESTAMP__"');
  return JSON.parse(out) as unknown;
}

async function invoke(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
): Promise<NormalizedResponse> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await app.request(`http://localhost${path}`, init);
  return normalizeResponse(res);
}

function assertMatchesFixture(
  actual: NormalizedResponse,
  name: string,
  idReplacements: Record<string, string> = {},
): void {
  const stable = normalizeTimestamps(normalizeIds(actual, idReplacements)) as NormalizedResponse;
  const expected = loadOrCapture(name, stable);
  expect(stable).toEqual(expected);
}

describe("account routes migration snapshot", () => {
  // 招待作成 route が内部で auth.api.signInMagicLink を呼び、better-auth の secondaryStorage
  // が Redis 経由の SET を発火する。redis の接続を張らないと Client closed の noisy error が
  // 出る (handler の .catch で握り潰しているので test は pass するが log が汚い)。
  beforeAll(async () => {
    await connectRedis();
  });
  beforeEach(async () => {
    restoreActor();
    await cleanupTestData();
  });
  afterAll(async () => {
    restoreActor();
    await cleanupTestData();
  });

  describe("QA-H-04 success bodies (12 移行 route) — 変更前 fixture との JSON deep-equal", () => {
    test("QA-H-02 GET /api/account/memberships (active membership 1 件)", async () => {
      const owner = await seedUser("mem-list-owner");
      const co = await seedCompany("mem-list");
      const memId = await seedMembership(owner.id, co, "OWNER");
      const { user } = await import("@/db/schema");
      await db.update(user).set({ lastUsedCompanyId: co }).where(eq(user.id, owner.id));

      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "GET", "/api/account/memberships");
      assertMatchesFixture(actual, "success-memberships", {
        [co]: "__COMPANY_ID__",
        [memId]: "__MEMBERSHIP_ID__",
      });
    });

    test("QA-H-02 / QA-H-03 POST /api/account/companies (signup 成功)", async () => {
      const actor = await seedUser("signup-ok");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/companies", {
        name: `${TEST_PREFIX}signup-created`,
        org_code: "CORPORATE",
      });
      const created = actual.body as {
        company: { id: string };
        membership: { id: string; company_id: string };
      };
      const companyId = created.company.id;
      const membershipId = created.membership.id;
      assertMatchesFixture(actual, "success-signup-company", {
        [companyId]: "__COMPANY_ID__",
        [membershipId]: "__MEMBERSHIP_ID__",
      });
    });

    test("QA-H-02 POST /api/account/companies/add", async () => {
      const actor = await seedUser("add-ok");
      const existing = await seedCompany("add-existing");
      await seedMembership(actor.id, existing, "OWNER");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/companies/add", {
        name: `${TEST_PREFIX}add-created`,
        org_code: "PERSONAL",
      });
      const created = actual.body as {
        company: { id: string };
        membership: { id: string };
      };
      assertMatchesFixture(actual, "success-add-company", {
        [created.company.id]: "__COMPANY_ID__",
        [created.membership.id]: "__MEMBERSHIP_ID__",
      });
    });

    test("QA-H-02 POST /api/account/companies/:companyId (update)", async () => {
      const owner = await seedUser("upd-owner");
      const co = await seedCompany("upd-target", "PERSONAL");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}`, {
        name: `${TEST_PREFIX}upd-renamed`,
        org_code: "CORPORATE",
      });
      assertMatchesFixture(actual, "success-update-company", { [co]: "__COMPANY_ID__" });
    });

    test("QA-H-02 GET /api/account/companies/:companyId/members", async () => {
      const owner = await seedUser("mem-owner");
      const co = await seedCompany("mem");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "GET", `/api/account/companies/${co}/members`);
      const listed = (actual.body as { members: { membership_id: string; user_id: string }[] })
        .members[0];
      assertMatchesFixture(actual, "success-members-list", {
        [co]: "__COMPANY_ID__",
        [owner.id]: "__USER_ID__",
        [listed.membership_id]: "__MEMBERSHIP_ID__",
        [owner.email]: "__EMAIL__",
      });
    });

    test("QA-H-02 GET /api/account/companies/:companyId/invitations", async () => {
      const owner = await seedUser("invs-owner");
      const co = await seedCompany("invs");
      await seedMembership(owner.id, co, "OWNER");
      const inv = await seedInvitation({
        companyId: co,
        email: `${TEST_PREFIX}invitee@example.com`,
        role: "MEMBER",
        invitedByUserId: owner.id,
      });
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "GET", `/api/account/companies/${co}/invitations`);
      assertMatchesFixture(actual, "success-invitations-list", {
        [co]: "__COMPANY_ID__",
        [inv.id]: "__INVITATION_ID__",
      });
    });

    test("QA-H-02 POST /api/account/companies/:companyId/invitations (create)", async () => {
      const owner = await seedUser("inv-create-owner");
      const co = await seedCompany("inv-create");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
        email: `${TEST_PREFIX}new-invitee@example.com`,
        role: "MEMBER",
      });
      const created = actual.body as { invitation: { id: string } };
      assertMatchesFixture(actual, "success-invitation-create", {
        [created.invitation.id]: "__INVITATION_ID__",
      });
    });

    test("QA-H-02 POST /api/account/companies/:companyId/invitations (reused for pending duplicate)", async () => {
      const owner = await seedUser("inv-reuse-owner");
      const co = await seedCompany("inv-reuse");
      await seedMembership(owner.id, co, "OWNER");
      const existing = await seedInvitation({
        companyId: co,
        email: `${TEST_PREFIX}reuse-invitee@example.com`,
        role: "MEMBER",
        invitedByUserId: owner.id,
      });
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
        email: `${TEST_PREFIX}reuse-invitee@example.com`,
        role: "MEMBER",
      });
      assertMatchesFixture(actual, "success-invitation-reused", {
        [existing.id]: "__INVITATION_ID__",
      });
    });

    test("QA-H-02 POST /api/account/companies/:companyId/invitations/:invitationId/revoke", async () => {
      const owner = await seedUser("rev-owner");
      const co = await seedCompany("rev");
      await seedMembership(owner.id, co, "OWNER");
      const inv = await seedInvitation({
        companyId: co,
        email: `${TEST_PREFIX}rev-invitee@example.com`,
        role: "MEMBER",
        invitedByUserId: owner.id,
      });
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/invitations/${inv.id}/revoke`,
      );
      assertMatchesFixture(actual, "success-invitation-revoke");
    });

    test("QA-H-02 POST /api/account/accept-invitation (OWNER 招待 · inviter 現役 OWNER)", async () => {
      const owner = await seedUser("acc-owner");
      const co = await seedCompany("acc");
      await seedMembership(owner.id, co, "OWNER");
      const invitee = await seedUser("acc-invitee");
      const inv = await seedInvitation({
        companyId: co,
        email: invitee.email,
        role: "OWNER",
        invitedByUserId: owner.id,
      });
      stubActor(invitee);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/accept-invitation", {
        invitation_token: inv.token,
      });
      assertMatchesFixture(actual, "success-accept-invitation", { [co]: "__COMPANY_ID__" });
    });

    test("QA-H-02 POST /api/account/companies/:companyId/members/:targetUserId/role", async () => {
      const owner = await seedUser("role-owner");
      const co = await seedCompany("role");
      await seedMembership(owner.id, co, "OWNER");
      const target = await seedUser("role-target");
      await seedMembership(target.id, co, "MEMBER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/members/${target.id}/role`,
        { role: "ADMIN" },
      );
      assertMatchesFixture(actual, "success-role-change");
      expect(await membershipRoleOf(target.id, co)).toBe("ADMIN");
    });

    test("QA-H-02 POST /api/account/companies/:companyId/members/:targetUserId/remove (self)", async () => {
      const owner = await seedUser("rm-owner");
      const co = await seedCompany("rm");
      await seedMembership(owner.id, co, "OWNER");
      const other = await seedUser("rm-other");
      await seedMembership(other.id, co, "OWNER");
      // 自身 (other) を退会。他 OWNER が 1 名残るため lock guard を通過する。
      stubActor(other);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/members/${other.id}/remove`,
      );
      assertMatchesFixture(actual, "success-member-remove-self");
    });

    test("QA-H-02 POST /api/account/companies/:companyId/transfer-ownership", async () => {
      const owner = await seedUser("xfer-owner");
      const co = await seedCompany("xfer");
      await seedMembership(owner.id, co, "OWNER");
      const target = await seedUser("xfer-target");
      await seedMembership(target.id, co, "MEMBER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/transfer-ownership`, {
        to_user_id: target.id,
      });
      assertMatchesFixture(actual, "success-transfer-ownership");
      expect(await membershipRoleOf(target.id, co)).toBe("OWNER");
      expect(await membershipRoleOf(owner.id, co)).toBe("ADMIN");
    });
  });

  describe("error catalog (QA-E-02: 全 route の error 文字列 × status)", () => {
    test("QA-E-01 ADMIN が role=OWNER 招待 → 403 forbidden (#104 route レベル regression)", async () => {
      const owner = await seedUser("i104-owner");
      const admin = await seedUser("i104-admin");
      const co = await seedCompany("i104");
      await seedMembership(owner.id, co, "OWNER");
      await seedMembership(admin.id, co, "ADMIN");
      stubActor(admin);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
        email: `${TEST_PREFIX}i104-invitee@example.com`,
        role: "OWNER",
      });
      assertMatchesFixture(actual, "error-invite-owner-as-admin");
    });

    test("MEMBER が invitations 発行 → 403 forbidden (requireMembership minRole=ADMIN)", async () => {
      const owner = await seedUser("mif-owner");
      const memberActor = await seedUser("mif-member");
      const co = await seedCompany("mif");
      await seedMembership(owner.id, co, "OWNER");
      await seedMembership(memberActor.id, co, "MEMBER");
      stubActor(memberActor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
        email: `${TEST_PREFIX}mif-invitee@example.com`,
        role: "MEMBER",
      });
      assertMatchesFixture(actual, "error-invitations-forbidden-member");
    });

    test("QA-E-03 POST /api/account/companies with empty name → 400 invalid_argument + details", async () => {
      const actor = await seedUser("iv-signup");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/companies", {
        name: "",
        org_code: "CORPORATE",
      });
      assertMatchesFixture(actual, "error-signup-invalid-details");
    });

    test("QA-E-03 POST /api/account/companies/add with empty name → 400 invalid_argument + details", async () => {
      const actor = await seedUser("iv-add");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/companies/add", {
        name: "",
        org_code: "CORPORATE",
      });
      assertMatchesFixture(actual, "error-add-invalid-details");
    });

    test("QA-E-03 POST invitations with invalid email → 400 invalid_argument + details", async () => {
      const owner = await seedUser("iv-inv-owner");
      const co = await seedCompany("iv-inv");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
        email: "not-an-email",
        role: "MEMBER",
      });
      assertMatchesFixture(actual, "error-invitations-invalid-details");
    });

    test("POST update company 未知 companyId → 403 forbidden (要 OWNER)", async () => {
      const actor = await seedUser("upd-nf");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/companies/cmp_does_not_exist", {
        name: `${TEST_PREFIX}whatever`,
        org_code: "PERSONAL",
      });
      assertMatchesFixture(actual, "error-update-forbidden-nonmember");
    });

    test("POST update company (invalid body) → 400 invalid_argument (no details)", async () => {
      const owner = await seedUser("upd-iv-owner");
      const co = await seedCompany("upd-iv");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}`, {
        name: "",
      });
      assertMatchesFixture(actual, "error-update-invalid");
    });

    test("POST role change unknown target → 404 not_found", async () => {
      const owner = await seedUser("rc-nf-owner");
      const co = await seedCompany("rc-nf");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/members/u_missing/role`,
        { role: "ADMIN" },
      );
      assertMatchesFixture(actual, "error-role-change-target-not-found");
    });

    test("POST role change invalid body → 400 invalid_argument", async () => {
      const owner = await seedUser("rc-iv-owner");
      const co = await seedCompany("rc-iv");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/members/u_x/role`, {
        role: "",
      });
      assertMatchesFixture(actual, "error-role-change-invalid");
    });

    test("POST role change ADMIN → OWNER by ADMIN → 403 forbidden", async () => {
      const owner = await seedUser("rc-fb-owner");
      const admin = await seedUser("rc-fb-admin");
      const target = await seedUser("rc-fb-target");
      const co = await seedCompany("rc-fb");
      await seedMembership(owner.id, co, "OWNER");
      await seedMembership(admin.id, co, "ADMIN");
      await seedMembership(target.id, co, "MEMBER");
      stubActor(admin);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/members/${target.id}/role`,
        { role: "OWNER" },
      );
      assertMatchesFixture(actual, "error-role-change-owner-by-admin");
    });

    test("POST role change 唯一の OWNER 降格 → 409 last_owner", async () => {
      const owner = await seedUser("rc-lo-owner");
      const co = await seedCompany("rc-lo");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/members/${owner.id}/role`,
        { role: "MEMBER" },
      );
      assertMatchesFixture(actual, "error-role-change-last-owner");
    });

    test("POST transfer-ownership unknown target → 404 not_found", async () => {
      const owner = await seedUser("xfer-nf-owner");
      const co = await seedCompany("xfer-nf");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/transfer-ownership`, {
        to_user_id: "u_missing",
      });
      assertMatchesFixture(actual, "error-transfer-target-not-found");
    });

    test("POST transfer-ownership self → 400 invalid_argument", async () => {
      const owner = await seedUser("xfer-self-owner");
      const co = await seedCompany("xfer-self");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/transfer-ownership`, {
        to_user_id: owner.id,
      });
      assertMatchesFixture(actual, "error-transfer-self");
    });

    test("POST transfer-ownership target already OWNER → 400 already_owner", async () => {
      const owner = await seedUser("xfer-ao-owner");
      const other = await seedUser("xfer-ao-other");
      const co = await seedCompany("xfer-ao");
      await seedMembership(owner.id, co, "OWNER");
      await seedMembership(other.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/transfer-ownership`, {
        to_user_id: other.id,
      });
      assertMatchesFixture(actual, "error-transfer-already-owner");
    });

    test("POST transfer-ownership by non-owner → 403 forbidden", async () => {
      const owner = await seedUser("xfer-fb-owner");
      const admin = await seedUser("xfer-fb-admin");
      const co = await seedCompany("xfer-fb");
      await seedMembership(owner.id, co, "OWNER");
      await seedMembership(admin.id, co, "ADMIN");
      stubActor(admin);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/transfer-ownership`, {
        to_user_id: owner.id,
      });
      assertMatchesFixture(actual, "error-transfer-forbidden");
    });

    test("POST remove member unknown target → 404 not_found", async () => {
      const owner = await seedUser("rm-nf-owner");
      const co = await seedCompany("rm-nf");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/members/u_missing/remove`,
      );
      assertMatchesFixture(actual, "error-remove-target-not-found");
    });

    test("POST remove OWNER by non-owner → 403 forbidden (canRemoveTarget)", async () => {
      const owner = await seedUser("rm-fb-owner");
      const admin = await seedUser("rm-fb-admin");
      const co = await seedCompany("rm-fb");
      await seedMembership(owner.id, co, "OWNER");
      await seedMembership(admin.id, co, "ADMIN");
      stubActor(admin);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/members/${owner.id}/remove`,
      );
      assertMatchesFixture(actual, "error-remove-owner-by-admin");
    });

    test("POST remove 唯一の OWNER 自己退会 → 409 last_owner", async () => {
      const owner = await seedUser("rm-lo-owner");
      const co = await seedCompany("rm-lo");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/members/${owner.id}/remove`,
      );
      assertMatchesFixture(actual, "error-remove-last-owner");
    });

    test("POST accept-invitation invalid body → 400 invalid_argument", async () => {
      const actor = await seedUser("acc-iv");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/accept-invitation", {});
      assertMatchesFixture(actual, "error-accept-invalid");
    });

    test("POST accept-invitation unknown token → 404 not_found", async () => {
      const actor = await seedUser("acc-nf");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/accept-invitation", {
        invitation_token: "does-not-exist",
      });
      assertMatchesFixture(actual, "error-accept-token-not-found");
    });

    test("POST accept-invitation email mismatch → 403 email_mismatch", async () => {
      const owner = await seedUser("acc-em-owner");
      const co = await seedCompany("acc-em");
      await seedMembership(owner.id, co, "OWNER");
      const invitee = await seedUser("acc-em-invitee");
      const inv = await seedInvitation({
        companyId: co,
        email: `${TEST_PREFIX}other-invitee@example.com`,
        role: "MEMBER",
        invitedByUserId: owner.id,
      });
      stubActor(invitee);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/accept-invitation", {
        invitation_token: inv.token,
      });
      assertMatchesFixture(actual, "error-accept-email-mismatch");
    });

    test("POST accept-invitation expired → 410 expired_or_used", async () => {
      const owner = await seedUser("acc-ex-owner");
      const co = await seedCompany("acc-ex");
      await seedMembership(owner.id, co, "OWNER");
      const invitee = await seedUser("acc-ex-invitee");
      const inv = await seedInvitation({
        companyId: co,
        email: invitee.email,
        role: "MEMBER",
        invitedByUserId: owner.id,
        expiresAt: new Date(Date.now() - 60_000),
      });
      stubActor(invitee);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/accept-invitation", {
        invitation_token: inv.token,
      });
      assertMatchesFixture(actual, "error-accept-expired");
    });

    test("POST revoke unknown invitation → 404 not_found_or_not_pending", async () => {
      const owner = await seedUser("rev-nf-owner");
      const co = await seedCompany("rev-nf");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        `/api/account/companies/${co}/invitations/inv_missing/revoke`,
      );
      assertMatchesFixture(actual, "error-revoke-not-found");
    });

    // 現状維持 2 route (削除・切替) — 移行対象外だが error catalog に含める。
    test("POST /api/account/companies/:companyId/delete non-owner → 403 forbidden", async () => {
      const owner = await seedUser("del-fb-owner");
      const member = await seedUser("del-fb-member");
      const co = await seedCompany("del-fb");
      await seedMembership(owner.id, co, "OWNER");
      await seedMembership(member.id, co, "MEMBER");
      stubActor(member);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", `/api/account/companies/${co}/delete`);
      assertMatchesFixture(actual, "error-delete-forbidden");
    });

    test("POST /api/account/companies/:companyId/delete unknown → 404 not_found_or_already_deleted", async () => {
      const actor = await seedUser("del-nf");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/companies/cmp_does_not_exist/delete");
      assertMatchesFixture(actual, "error-delete-not-found");
    });

    test("POST /api/account/current-company invalid body → 400 invalid_argument", async () => {
      const actor = await seedUser("cur-iv");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/current-company", {});
      assertMatchesFixture(actual, "error-current-company-invalid");
    });

    test("POST /api/account/current-company unknown target → 403 forbidden", async () => {
      const actor = await seedUser("cur-fb");
      stubActor(actor);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/current-company", {
        company_id: "cmp_not_membership",
      });
      assertMatchesFixture(actual, "error-current-company-forbidden");
    });
  });

  describe("QA-D-01 401 が 400/403/404 に優先 (順序保証)", () => {
    test("cookie 無しで invalid body 付き invite → 401 unauthorized (400 に落ちない)", async () => {
      stubActor(null);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/companies/co_x/invitations", {
        email: "not-an-email",
        role: "OWNER",
      });
      expect(actual.status).toBe(401);
      expect(actual.body).toEqual({ error: "unauthorized" });
    });

    test("cookie 無しで unknown companyId 付き role change → 401 unauthorized (403/404 に落ちない)", async () => {
      stubActor(null);
      const app = buildTestApp();
      const actual = await invoke(
        app,
        "POST",
        "/api/account/companies/cmp_missing/members/u_missing/role",
        { role: "ADMIN" },
      );
      expect(actual.status).toBe(401);
      expect(actual.body).toEqual({ error: "unauthorized" });
    });
  });

  describe("QA-D-02 getSession が同期 throw (期限切れ cookie の DI 差替相当) でも fail-closed 401", () => {
    test("getSession throw → 401 unauthorized", async () => {
      const app = buildTestApp();
      // helpers.stubActor は Promise を返すが、生 throw も fail-closed で 401 に落ちる契約を
      // 確認する。auth.api.getSession を同期 throw に差し替える。
      const { auth } = await import("../../auth");
      const original = auth.api.getSession;
      auth.api.getSession = (() => {
        throw new Error("sync throw simulating expired session lookup");
      }) as any;
      try {
        const actual = await invoke(app, "GET", "/api/account/memberships");
        expect(actual.status).toBe(401);
        expect(actual.body).toEqual({ error: "unauthorized" });
      } finally {
        auth.api.getSession = original;
      }
    });
  });

  describe("QA-M-03 / QA-M-08 Content-Type 監視", () => {
    test("成功 response の Content-Type", async () => {
      const owner = await seedUser("ct-owner");
      const co = await seedCompany("ct");
      await seedMembership(owner.id, co, "OWNER");
      stubActor(owner);
      const app = buildTestApp();
      const res = await app.request(`http://localhost/api/account/companies/${co}/members`);
      // Hono c.json は charset なしの `application/json` を返す (移行後も同一)。
      // guardErrorResponse も同 Content-Type を明示 header で付与し byte-invariant を守る。
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    });

    test("error response の Content-Type", async () => {
      stubActor(null);
      const app = buildTestApp();
      const res = await app.request("http://localhost/api/account/memberships");
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    });
  });

  describe("QA-M-01 accept-invitation reused 短絡の route レベル担保", () => {
    // entry (requireInvitationAccept) が既所属 short-circuit を返し、accept use-case が起動しない
    // 契約を route レベルで固定する。PENDING invitation と期限切れ invitation の両方をカバーし、
    // 「既に member なら invitation の期限に関係なく 200 reused を返す」冪等契約を維持する
    // (isAcceptable より先に短絡させることで、期限切れでも既所属なら 200 という現行挙動を保つ)。
    test("QA-M-01 既所属 member が PENDING invitation を再 accept → 200 reused", async () => {
      const owner = await seedUser("m01-r-owner");
      const co = await seedCompany("m01-r");
      await seedMembership(owner.id, co, "OWNER");
      const invitee = await seedUser("m01-r-invitee");
      await seedMembership(invitee.id, co, "MEMBER");
      const inv = await seedInvitation({
        companyId: co,
        email: invitee.email,
        role: "MEMBER",
        invitedByUserId: owner.id,
      });
      stubActor(invitee);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/accept-invitation", {
        invitation_token: inv.token,
      });
      expect(actual.status).toBe(200);
      expect(actual.body).toEqual({ ok: true, company_id: co, reused: true });
      // invitation は PENDING のまま (accept use-case は起動しないため markAccepted しない)。
      const invRow = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, inv.id))
        .then((r) => r.at(0));
      expect(invRow?.status).toBe("PENDING");
    });

    test("QA-M-01 既所属 member が 期限切れ invitation を再 accept → 200 reused (isAcceptable より前に短絡)", async () => {
      const owner = await seedUser("m01-e-owner");
      const co = await seedCompany("m01-e");
      await seedMembership(owner.id, co, "OWNER");
      const invitee = await seedUser("m01-e-invitee");
      await seedMembership(invitee.id, co, "MEMBER");
      const inv = await seedInvitation({
        companyId: co,
        email: invitee.email,
        role: "MEMBER",
        invitedByUserId: owner.id,
        expiresAt: new Date(Date.now() - 60_000),
      });
      stubActor(invitee);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/accept-invitation", {
        invitation_token: inv.token,
      });
      expect(actual.status).toBe(200);
      expect(actual.body).toEqual({ ok: true, company_id: co, reused: true });
    });
  });

  describe("QA-R-06 accept 経路の副作用不変性", () => {
    test("正常 accept (現役 OWNER 招待者) では invitation_accept_rejected event が 0 件", async () => {
      const owner = await seedUser("ra-owner");
      const co = await seedCompany("ra");
      await seedMembership(owner.id, co, "OWNER");
      const invitee = await seedUser("ra-invitee");
      const inv = await seedInvitation({
        companyId: co,
        email: invitee.email,
        role: "OWNER",
        invitedByUserId: owner.id,
      });
      stubActor(invitee);
      const app = buildTestApp();
      const actual = await invoke(app, "POST", "/api/account/accept-invitation", {
        invitation_token: inv.token,
      });
      expect(actual.status).toBe(200);

      const rejected = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.eventType, "invitation_accept_rejected"),
            eq(auditLog.userId, invitee.id),
          ),
        );
      expect(rejected.length).toBe(0);

      const invRow = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, inv.id))
        .then((r) => r.at(0));
      expect(invRow?.status).toBe("ACCEPTED");

      const memRow = await db
        .select()
        .from(membership)
        .where(and(eq(membership.userId, invitee.id), eq(membership.companyId, co)));
      expect(memRow.length).toBe(1);
    });
  });
});

// server 側 auth-entry-redirect と SPA page guard (SignUpCompany) は同じ「ACTIVE membership の
// 有無」を別実装で判定する 2 者契約 (#74 redirect loop はこの不一致で再発する)。server 側は
// auth-entry-redirect.test.ts が固定するため、ここでは SPA が読む GET /api/account/memberships が
// DELETED company を返さないことを対で固定する。
describe("GET /api/account/memberships の ACTIVE filter (redirect loop の 2 者契約 pin)", () => {
  beforeEach(cleanupTestData);

  test("DELETED company のみ所属する user には memberships が空配列で返る", async () => {
    const { company } = await import("@/db/schema");
    const actor = await seedUser("mem-deleted-only");
    const co = await seedCompany("mem-deleted-only");
    await seedMembership(actor.id, co, "OWNER");
    await db.update(company).set({ activationStatus: "DELETED" }).where(eq(company.id, co));
    stubActor(actor);

    const actual = await invoke(buildTestApp(), "GET", "/api/account/memberships");

    expect(actual.status).toBe(200);
    expect(actual.body).toEqual({ current_company_id: null, memberships: [] });
    restoreActor();
  });
});
