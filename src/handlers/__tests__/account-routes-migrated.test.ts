import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { Hono } from "hono";
import { auth } from "../../auth";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import {
  buildTestApp,
  normalizeResponse,
  requestApp,
  restoreActor,
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
const { run, cleanup } = dbTest(TEST_PREFIX);

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

const invoke = (
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
): Effect.Effect<NormalizedResponse> => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return requestApp(app, `http://localhost${path}`, init).pipe(
    Effect.flatMap((res) => Effect.promise(() => normalizeResponse(res))),
  );
};

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
  beforeEach(() => {
    restoreActor();
    return cleanup();
  });
  afterAll(() => {
    restoreActor();
    return cleanup();
  });

  describe("QA-H-04 success bodies (12 移行 route) — 変更前 fixture との JSON deep-equal", () => {
    test("QA-H-02 GET /api/account/memberships (active membership 1 件)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("mem-list-owner");
          const co = yield* db.seedCompany("mem-list");
          const memId = yield* db.seedMembership(owner.id, co, "OWNER");
          yield* db.setLastUsedCompany(owner.id, co);

          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(app, "GET", "/api/account/memberships");
          assertMatchesFixture(actual, "success-memberships", {
            [co]: "__COMPANY_ID__",
            [memId]: "__MEMBERSHIP_ID__",
          });
        }),
      ));

    test("QA-H-02 / QA-H-03 POST /api/account/companies (signup 成功)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("signup-ok");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/companies", {
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
        }),
      ));

    test("QA-H-02 POST /api/account/companies/add", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("add-ok");
          const existing = yield* db.seedCompany("add-existing");
          yield* db.seedMembership(actor.id, existing, "OWNER");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/companies/add", {
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
        }),
      ));

    test("QA-H-02 POST /api/account/companies/:companyId (update)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("upd-owner");
          const co = yield* db.seedCompany("upd-target", "PERSONAL");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", `/api/account/companies/${co}`, {
            name: `${TEST_PREFIX}upd-renamed`,
            org_code: "CORPORATE",
          });
          assertMatchesFixture(actual, "success-update-company", { [co]: "__COMPANY_ID__" });
        }),
      ));

    test("QA-H-02 GET /api/account/companies/:companyId/members", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("mem-owner");
          const co = yield* db.seedCompany("mem");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(app, "GET", `/api/account/companies/${co}/members`);
          const listed = (actual.body as { members: { membership_id: string; user_id: string }[] })
            .members[0];
          assertMatchesFixture(actual, "success-members-list", {
            [co]: "__COMPANY_ID__",
            [owner.id]: "__USER_ID__",
            [listed.membership_id]: "__MEMBERSHIP_ID__",
            [owner.email]: "__EMAIL__",
          });
        }),
      ));

    test("QA-H-02 GET /api/account/companies/:companyId/invitations", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("invs-owner");
          const co = yield* db.seedCompany("invs");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: `${TEST_PREFIX}invitee@example.com`,
            role: "MEMBER",
            invitedByUserId: owner.id,
          });
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(app, "GET", `/api/account/companies/${co}/invitations`);
          assertMatchesFixture(actual, "success-invitations-list", {
            [co]: "__COMPANY_ID__",
            [inv.id]: "__INVITATION_ID__",
          });
        }),
      ));

    test("QA-H-02 POST /api/account/companies/:companyId/invitations (create)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("inv-create-owner");
          const co = yield* db.seedCompany("inv-create");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
            email: `${TEST_PREFIX}new-invitee@example.com`,
            role: "MEMBER",
          });
          const created = actual.body as { invitation: { id: string } };
          assertMatchesFixture(actual, "success-invitation-create", {
            [created.invitation.id]: "__INVITATION_ID__",
          });
        }),
      ));

    test("QA-H-02 POST /api/account/companies/:companyId/invitations (reused for pending duplicate)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("inv-reuse-owner");
          const co = yield* db.seedCompany("inv-reuse");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const existing = yield* db.seedInvitation({
            companyId: co,
            email: `${TEST_PREFIX}reuse-invitee@example.com`,
            role: "MEMBER",
            invitedByUserId: owner.id,
          });
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
            email: `${TEST_PREFIX}reuse-invitee@example.com`,
            role: "MEMBER",
          });
          assertMatchesFixture(actual, "success-invitation-reused", {
            [existing.id]: "__INVITATION_ID__",
          });
        }),
      ));

    test("QA-H-02 POST /api/account/companies/:companyId/invitations/:invitationId/revoke", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rev-owner");
          const co = yield* db.seedCompany("rev");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: `${TEST_PREFIX}rev-invitee@example.com`,
            role: "MEMBER",
            invitedByUserId: owner.id,
          });
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/invitations/${inv.id}/revoke`,
          );
          assertMatchesFixture(actual, "success-invitation-revoke");
        }),
      ));

    test("QA-H-02 POST /api/account/accept-invitation (OWNER 招待 · inviter 現役 OWNER)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("acc-owner");
          const co = yield* db.seedCompany("acc");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const invitee = yield* db.seedUser("acc-invitee");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: invitee.email,
            role: "OWNER",
            invitedByUserId: owner.id,
          });
          stubActor(invitee);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/accept-invitation", {
            invitation_token: inv.token,
          });
          assertMatchesFixture(actual, "success-accept-invitation", { [co]: "__COMPANY_ID__" });
        }),
      ));

    test("QA-H-02 POST /api/account/companies/:companyId/members/:targetUserId/role", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("role-owner");
          const co = yield* db.seedCompany("role");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const target = yield* db.seedUser("role-target");
          yield* db.seedMembership(target.id, co, "MEMBER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/${target.id}/role`,
            { role: "ADMIN" },
          );
          assertMatchesFixture(actual, "success-role-change");
          expect((yield* db.readMembership(target.id, co))?.role).toBe("ADMIN");
        }),
      ));

    test("QA-H-02 POST /api/account/companies/:companyId/members/:targetUserId/remove (self)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rm-owner");
          const co = yield* db.seedCompany("rm");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const other = yield* db.seedUser("rm-other");
          yield* db.seedMembership(other.id, co, "OWNER");
          // 自身 (other) を退会。他 OWNER が 1 名残るため lock guard を通過する。
          stubActor(other);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/${other.id}/remove`,
          );
          assertMatchesFixture(actual, "success-member-remove-self");
        }),
      ));

    test("QA-H-02 POST /api/account/companies/:companyId/transfer-ownership", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("xfer-owner");
          const co = yield* db.seedCompany("xfer");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const target = yield* db.seedUser("xfer-target");
          yield* db.seedMembership(target.id, co, "MEMBER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/transfer-ownership`,
            {
              to_user_id: target.id,
            },
          );
          assertMatchesFixture(actual, "success-transfer-ownership");
          expect((yield* db.readMembership(target.id, co))?.role).toBe("OWNER");
          expect((yield* db.readMembership(owner.id, co))?.role).toBe("ADMIN");
        }),
      ));
  });

  describe("error catalog (QA-E-02: 全 route の error 文字列 × status)", () => {
    test("QA-E-01 ADMIN が role=OWNER 招待 → 403 forbidden (#104 route レベル regression)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("i104-owner");
          const admin = yield* db.seedUser("i104-admin");
          const co = yield* db.seedCompany("i104");
          yield* db.seedMembership(owner.id, co, "OWNER");
          yield* db.seedMembership(admin.id, co, "ADMIN");
          stubActor(admin);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
            email: `${TEST_PREFIX}i104-invitee@example.com`,
            role: "OWNER",
          });
          assertMatchesFixture(actual, "error-invite-owner-as-admin");
        }),
      ));

    test("MEMBER が invitations 発行 → 403 forbidden (requireMembership minRole=ADMIN)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("mif-owner");
          const memberActor = yield* db.seedUser("mif-member");
          const co = yield* db.seedCompany("mif");
          yield* db.seedMembership(owner.id, co, "OWNER");
          yield* db.seedMembership(memberActor.id, co, "MEMBER");
          stubActor(memberActor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
            email: `${TEST_PREFIX}mif-invitee@example.com`,
            role: "MEMBER",
          });
          assertMatchesFixture(actual, "error-invitations-forbidden-member");
        }),
      ));

    test("QA-E-03 POST /api/account/companies with empty name → 400 invalid_argument + details", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("iv-signup");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/companies", {
            name: "",
            org_code: "CORPORATE",
          });
          assertMatchesFixture(actual, "error-signup-invalid-details");
        }),
      ));

    test("QA-E-03 POST /api/account/companies/add with empty name → 400 invalid_argument + details", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("iv-add");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/companies/add", {
            name: "",
            org_code: "CORPORATE",
          });
          assertMatchesFixture(actual, "error-add-invalid-details");
        }),
      ));

    test("QA-E-03 POST invitations with invalid email → 400 invalid_argument + details", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("iv-inv-owner");
          const co = yield* db.seedCompany("iv-inv");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", `/api/account/companies/${co}/invitations`, {
            email: "not-an-email",
            role: "MEMBER",
          });
          assertMatchesFixture(actual, "error-invitations-invalid-details");
        }),
      ));

    test("POST update company 未知 companyId → 403 forbidden (要 OWNER)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("upd-nf");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/companies/cmp_does_not_exist", {
            name: `${TEST_PREFIX}whatever`,
            org_code: "PERSONAL",
          });
          assertMatchesFixture(actual, "error-update-forbidden-nonmember");
        }),
      ));

    test("POST update company (invalid body) → 400 invalid_argument (no details)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("upd-iv-owner");
          const co = yield* db.seedCompany("upd-iv");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", `/api/account/companies/${co}`, {
            name: "",
          });
          assertMatchesFixture(actual, "error-update-invalid");
        }),
      ));

    test("POST role change unknown target → 404 not_found", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rc-nf-owner");
          const co = yield* db.seedCompany("rc-nf");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/u_missing/role`,
            { role: "ADMIN" },
          );
          assertMatchesFixture(actual, "error-role-change-target-not-found");
        }),
      ));

    test("POST role change invalid body → 400 invalid_argument", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rc-iv-owner");
          const co = yield* db.seedCompany("rc-iv");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/u_x/role`,
            {
              role: "",
            },
          );
          assertMatchesFixture(actual, "error-role-change-invalid");
        }),
      ));

    test("POST role change ADMIN → OWNER by ADMIN → 403 forbidden", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rc-fb-owner");
          const admin = yield* db.seedUser("rc-fb-admin");
          const target = yield* db.seedUser("rc-fb-target");
          const co = yield* db.seedCompany("rc-fb");
          yield* db.seedMembership(owner.id, co, "OWNER");
          yield* db.seedMembership(admin.id, co, "ADMIN");
          yield* db.seedMembership(target.id, co, "MEMBER");
          stubActor(admin);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/${target.id}/role`,
            { role: "OWNER" },
          );
          assertMatchesFixture(actual, "error-role-change-owner-by-admin");
        }),
      ));

    test("POST role change 唯一の OWNER 降格 → 409 last_owner", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rc-lo-owner");
          const co = yield* db.seedCompany("rc-lo");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/${owner.id}/role`,
            { role: "MEMBER" },
          );
          assertMatchesFixture(actual, "error-role-change-last-owner");
        }),
      ));

    test("POST transfer-ownership unknown target → 404 not_found", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("xfer-nf-owner");
          const co = yield* db.seedCompany("xfer-nf");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/transfer-ownership`,
            {
              to_user_id: "u_missing",
            },
          );
          assertMatchesFixture(actual, "error-transfer-target-not-found");
        }),
      ));

    test("POST transfer-ownership self → 400 invalid_argument", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("xfer-self-owner");
          const co = yield* db.seedCompany("xfer-self");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/transfer-ownership`,
            {
              to_user_id: owner.id,
            },
          );
          assertMatchesFixture(actual, "error-transfer-self");
        }),
      ));

    test("POST transfer-ownership target already OWNER → 400 already_owner", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("xfer-ao-owner");
          const other = yield* db.seedUser("xfer-ao-other");
          const co = yield* db.seedCompany("xfer-ao");
          yield* db.seedMembership(owner.id, co, "OWNER");
          yield* db.seedMembership(other.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/transfer-ownership`,
            {
              to_user_id: other.id,
            },
          );
          assertMatchesFixture(actual, "error-transfer-already-owner");
        }),
      ));

    test("POST transfer-ownership by non-owner → 403 forbidden", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("xfer-fb-owner");
          const admin = yield* db.seedUser("xfer-fb-admin");
          const co = yield* db.seedCompany("xfer-fb");
          yield* db.seedMembership(owner.id, co, "OWNER");
          yield* db.seedMembership(admin.id, co, "ADMIN");
          stubActor(admin);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/transfer-ownership`,
            {
              to_user_id: owner.id,
            },
          );
          assertMatchesFixture(actual, "error-transfer-forbidden");
        }),
      ));

    test("POST remove member unknown target → 404 not_found", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rm-nf-owner");
          const co = yield* db.seedCompany("rm-nf");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/u_missing/remove`,
          );
          assertMatchesFixture(actual, "error-remove-target-not-found");
        }),
      ));

    test("POST remove OWNER by non-owner → 403 forbidden (canRemoveTarget)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rm-fb-owner");
          const admin = yield* db.seedUser("rm-fb-admin");
          const co = yield* db.seedCompany("rm-fb");
          yield* db.seedMembership(owner.id, co, "OWNER");
          yield* db.seedMembership(admin.id, co, "ADMIN");
          stubActor(admin);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/${owner.id}/remove`,
          );
          assertMatchesFixture(actual, "error-remove-owner-by-admin");
        }),
      ));

    test("POST remove 唯一の OWNER 自己退会 → 409 last_owner", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rm-lo-owner");
          const co = yield* db.seedCompany("rm-lo");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/members/${owner.id}/remove`,
          );
          assertMatchesFixture(actual, "error-remove-last-owner");
        }),
      ));

    test("POST accept-invitation invalid body → 400 invalid_argument", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("acc-iv");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/accept-invitation", {});
          assertMatchesFixture(actual, "error-accept-invalid");
        }),
      ));

    test("POST accept-invitation unknown token → 404 not_found", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("acc-nf");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/accept-invitation", {
            invitation_token: "does-not-exist",
          });
          assertMatchesFixture(actual, "error-accept-token-not-found");
        }),
      ));

    test("POST accept-invitation email mismatch → 403 email_mismatch", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("acc-em-owner");
          const co = yield* db.seedCompany("acc-em");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const invitee = yield* db.seedUser("acc-em-invitee");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: `${TEST_PREFIX}other-invitee@example.com`,
            role: "MEMBER",
            invitedByUserId: owner.id,
          });
          stubActor(invitee);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/accept-invitation", {
            invitation_token: inv.token,
          });
          assertMatchesFixture(actual, "error-accept-email-mismatch");
        }),
      ));

    test("POST accept-invitation expired → 410 expired_or_used", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("acc-ex-owner");
          const co = yield* db.seedCompany("acc-ex");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const invitee = yield* db.seedUser("acc-ex-invitee");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: invitee.email,
            role: "MEMBER",
            invitedByUserId: owner.id,
            expiresAt: new Date(Date.now() - 60_000),
          });
          stubActor(invitee);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/accept-invitation", {
            invitation_token: inv.token,
          });
          assertMatchesFixture(actual, "error-accept-expired");
        }),
      ));

    test("POST revoke unknown invitation → 404 not_found_or_not_pending", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("rev-nf-owner");
          const co = yield* db.seedCompany("rev-nf");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            `/api/account/companies/${co}/invitations/inv_missing/revoke`,
          );
          assertMatchesFixture(actual, "error-revoke-not-found");
        }),
      ));

    // 現状維持 2 route (削除・切替) — 移行対象外だが error catalog に含める。
    test("POST /api/account/companies/:companyId/delete non-owner → 403 forbidden", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("del-fb-owner");
          const member = yield* db.seedUser("del-fb-member");
          const co = yield* db.seedCompany("del-fb");
          yield* db.seedMembership(owner.id, co, "OWNER");
          yield* db.seedMembership(member.id, co, "MEMBER");
          stubActor(member);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", `/api/account/companies/${co}/delete`);
          assertMatchesFixture(actual, "error-delete-forbidden");
        }),
      ));

    test("POST /api/account/companies/:companyId/delete unknown → 404 not_found_or_already_deleted", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("del-nf");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            "/api/account/companies/cmp_does_not_exist/delete",
          );
          assertMatchesFixture(actual, "error-delete-not-found");
        }),
      ));

    test("POST /api/account/current-company invalid body → 400 invalid_argument", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("cur-iv");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/current-company", {});
          assertMatchesFixture(actual, "error-current-company-invalid");
        }),
      ));

    test("POST /api/account/current-company unknown target → 403 forbidden", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const actor = yield* db.seedUser("cur-fb");
          stubActor(actor);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/current-company", {
            company_id: "cmp_not_membership",
          });
          assertMatchesFixture(actual, "error-current-company-forbidden");
        }),
      ));
  });

  describe("QA-D-01 401 が 400/403/404 に優先 (順序保証)", () => {
    test("cookie 無しで invalid body 付き invite → 401 unauthorized (400 に落ちない)", () =>
      run(
        Effect.gen(function* () {
          stubActor(null);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/companies/co_x/invitations", {
            email: "not-an-email",
            role: "OWNER",
          });
          expect(actual.status).toBe(401);
          expect(actual.body).toEqual({ error: "unauthorized" });
        }),
      ));

    test("cookie 無しで unknown companyId 付き role change → 401 unauthorized (403/404 に落ちない)", () =>
      run(
        Effect.gen(function* () {
          stubActor(null);
          const app = buildTestApp();
          const actual = yield* invoke(
            app,
            "POST",
            "/api/account/companies/cmp_missing/members/u_missing/role",
            { role: "ADMIN" },
          );
          expect(actual.status).toBe(401);
          expect(actual.body).toEqual({ error: "unauthorized" });
        }),
      ));
  });

  describe("QA-D-02 getSession が同期 throw (期限切れ cookie の DI 差替相当) でも fail-closed 401", () => {
    test("getSession throw → 401 unauthorized", () =>
      run(
        Effect.gen(function* () {
          const app = buildTestApp();
          // helpers.stubActor は Promise を返すが、生 throw も fail-closed で 401 に落ちる契約を
          // 確認する。auth.api.getSession を同期 throw に差し替える。
          const original = auth.api.getSession;
          auth.api.getSession = (() => {
            throw new Error("sync throw simulating expired session lookup");
          }) as any;
          const actual = yield* invoke(app, "GET", "/api/account/memberships").pipe(
            Effect.ensuring(
              Effect.sync(() => {
                auth.api.getSession = original;
              }),
            ),
          );
          expect(actual.status).toBe(401);
          expect(actual.body).toEqual({ error: "unauthorized" });
        }),
      ));
  });

  describe("QA-M-03 / QA-M-08 Content-Type 監視", () => {
    test("成功 response の Content-Type", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("ct-owner");
          const co = yield* db.seedCompany("ct");
          yield* db.seedMembership(owner.id, co, "OWNER");
          stubActor(owner);
          const app = buildTestApp();
          const res = yield* requestApp(
            app,
            `http://localhost/api/account/companies/${co}/members`,
          );
          // Hono c.json は charset なしの `application/json` を返す (移行後も同一)。
          // guardErrorResponse も同 Content-Type を明示 header で付与し byte-invariant を守る。
          expect(res.headers.get("content-type")).toMatch(/^application\/json/);
        }),
      ));

    test("error response の Content-Type", () =>
      run(
        Effect.gen(function* () {
          stubActor(null);
          const app = buildTestApp();
          const res = yield* requestApp(app, "http://localhost/api/account/memberships");
          expect(res.status).toBe(401);
          expect(res.headers.get("content-type")).toMatch(/^application\/json/);
        }),
      ));
  });

  describe("QA-M-01 accept-invitation reused 短絡の route レベル担保", () => {
    // entry (requireInvitationAccept) が既所属 short-circuit を返し、accept use-case が起動しない
    // 契約を route レベルで固定する。PENDING invitation と期限切れ invitation の両方をカバーし、
    // 「既に member なら invitation の期限に関係なく 200 reused を返す」冪等契約を維持する
    // (isAcceptable より先に短絡させることで、期限切れでも既所属なら 200 という現行挙動を保つ)。
    test("QA-M-01 既所属 member が PENDING invitation を再 accept → 200 reused", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("m01-r-owner");
          const co = yield* db.seedCompany("m01-r");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const invitee = yield* db.seedUser("m01-r-invitee");
          yield* db.seedMembership(invitee.id, co, "MEMBER");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: invitee.email,
            role: "MEMBER",
            invitedByUserId: owner.id,
          });
          stubActor(invitee);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/accept-invitation", {
            invitation_token: inv.token,
          });
          expect(actual.status).toBe(200);
          expect(actual.body).toEqual({ ok: true, company_id: co, reused: true });
          // invitation は PENDING のまま (accept use-case は起動しないため markAccepted しない)。
          expect((yield* db.readInvitation(inv.id))?.status).toBe("PENDING");
        }),
      ));

    test("QA-M-01 既所属 member が 期限切れ invitation を再 accept → 200 reused (isAcceptable より前に短絡)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("m01-e-owner");
          const co = yield* db.seedCompany("m01-e");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const invitee = yield* db.seedUser("m01-e-invitee");
          yield* db.seedMembership(invitee.id, co, "MEMBER");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: invitee.email,
            role: "MEMBER",
            invitedByUserId: owner.id,
            expiresAt: new Date(Date.now() - 60_000),
          });
          stubActor(invitee);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/accept-invitation", {
            invitation_token: inv.token,
          });
          expect(actual.status).toBe(200);
          expect(actual.body).toEqual({ ok: true, company_id: co, reused: true });
        }),
      ));
  });

  describe("QA-R-06 accept 経路の副作用不変性", () => {
    test("正常 accept (現役 OWNER 招待者) では invitation_accept_rejected event が 0 件", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const owner = yield* db.seedUser("ra-owner");
          const co = yield* db.seedCompany("ra");
          yield* db.seedMembership(owner.id, co, "OWNER");
          const invitee = yield* db.seedUser("ra-invitee");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: invitee.email,
            role: "OWNER",
            invitedByUserId: owner.id,
          });
          stubActor(invitee);
          const app = buildTestApp();
          const actual = yield* invoke(app, "POST", "/api/account/accept-invitation", {
            invitation_token: inv.token,
          });
          expect(actual.status).toBe(200);

          expect((yield* db.readAuditRows(invitee.id, "invitation_accept_rejected")).length).toBe(
            0,
          );
          expect((yield* db.readInvitation(inv.id))?.status).toBe("ACCEPTED");
          expect(yield* db.readMembership(invitee.id, co)).toBeDefined();
        }),
      ));
  });
});

// server 側 auth-entry-redirect と SPA page guard (SignUpCompany) は同じ「ACTIVE membership の
// 有無」を別実装で判定する 2 者契約 (#74 redirect loop はこの不一致で再発する)。server 側は
// auth-entry-redirect.test.ts が固定するため、ここでは SPA が読む GET /api/account/memberships が
// DELETED company を返さないことを対で固定する。
describe("GET /api/account/memberships の ACTIVE filter (redirect loop の 2 者契約 pin)", () => {
  beforeEach(cleanup);

  test("DELETED company のみ所属する user には memberships が空配列で返る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const actor = yield* db.seedUser("mem-deleted-only");
        const co = yield* db.seedCompany("mem-deleted-only");
        yield* db.seedMembership(actor.id, co, "OWNER");
        yield* db.markCompanyDeleted(co, { deletedAt: false });
        stubActor(actor);

        const actual = yield* invoke(buildTestApp(), "GET", "/api/account/memberships");

        expect(actual.status).toBe(200);
        expect(actual.body).toEqual({ current_company_id: null, memberships: [] });
        restoreActor();
      }),
    ));
});
