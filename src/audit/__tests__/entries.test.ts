import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import type { AuditLogEntry } from "@/db/repositories/audit-log";
import { auditRowsFor, dbTest, drained, withSpy } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { deleteAccountUnlessLastOwner } from "../../account/delete-account";
import { switchCurrentCompany } from "../../membership/current-company";
import { addCompany } from "../../company/create";
import { deleteCompany } from "../../company/delete";
import { updateCompanyInfo } from "../../company/update";
import { acceptInvitation } from "../../invitation/accept";
import { createInvitation } from "../../invitation/create";
import { revokeInvitation } from "../../invitation/revoke";
import { changeRole } from "../../membership/change-role";
import { removeMember } from "../../membership/remove";
import { transferOwnership } from "../../membership/transfer-ownership";
import { enableMfaFor, totpCode } from "../../mfa/__tests__/helpers";
import { loginWithMagicLink } from "../../__tests__/session-helpers";
import { disable } from "../../mfa/totp";
import type { AppServices } from "../../runtime";
import {
  acceptGrantForTest,
  inviteGrantForTest,
  memberForTest,
  removalGrantForTest,
  roleChangeGrantForTest,
  transferGrantForTest,
} from "../../membership/__tests__/verified-for-test";

type EventType = AuditLogEntry["eventType"];
type Drive = Effect.Effect<string, unknown, AppServices | TestDb>;

const P = "audit-entries-";
const { run, cleanup } = dbTest(P);

const CONSUMER_CALLBACK = "https://app.example.com/dashboard";

const seedOwnedCompany = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const owner = yield* db.seedUser(`${suffix}-owner`);
    const companyId = yield* db.seedCompany(suffix);
    yield* db.seedMembership(owner.id, companyId, "OWNER");
    return { db, owner, companyId };
  });

const seedInvitationTo = (
  suffix: string,
  role: "OWNER" | "MEMBER",
  inviterRoleAtAccept: "OWNER" | "ADMIN",
) =>
  Effect.gen(function* () {
    const { db, owner, companyId } = yield* seedOwnedCompany(suffix);
    const invitee = yield* db.seedUser(`${suffix}-invitee`);
    const seeded = yield* db.seedInvitation({
      companyId,
      email: invitee.email,
      role,
      invitedByUserId: owner.id,
    });
    yield* db.setMembershipRole(owner.id, companyId, inviterRoleAtAccept);
    const invitation = yield* db.readInvitationByToken(seeded.token);
    if (!invitation) return yield* Effect.die(new Error("seed failed"));
    return { db, owner, companyId, invitee, invitation, invitationId: seeded.id };
  });

const WRITTEN_BEFORE_REFACTOR = {
  sign_in: {
    keys: ["method", "ip", "userAgent"],
    drive: Effect.gen(function* () {
      const user = yield* TestDb.use((db) => db.seedUser("sign-in"));
      yield* loginWithMagicLink({ email: user.email, callbackURL: CONSUMER_CALLBACK });
      return user.id;
    }),
  },
  mfa_enabled: {
    keys: ["ip", "userAgent"],
    drive: Effect.gen(function* () {
      const user = yield* TestDb.use((db) => db.seedUser("mfa-enabled"));
      yield* drained(enableMfaFor(user));
      return user.id;
    }),
  },
  mfa_disabled: {
    keys: ["ip", "userAgent"],
    drive: Effect.gen(function* () {
      const user = yield* TestDb.use((db) => db.seedUser("mfa-disabled"));
      const enabled = yield* drained(enableMfaFor(user));
      yield* drained(
        disable({
          actor: enabled.actor,
          headers: enabled.session.headers,
          code: yield* totpCode(enabled.secret, 1),
          kind: "totp",
        }),
      );
      return user.id;
    }),
  },
  account_delete: {
    keys: [],
    drive: Effect.gen(function* () {
      const user = yield* TestDb.use((db) => db.seedUser("account-delete"));
      yield* deleteAccountUnlessLastOwner(user.id);
      return user.id;
    }),
  },
  company_created: {
    keys: ["company_id", "name", "org_code", "created_by_user_id"],
    drive: Effect.gen(function* () {
      const db = yield* TestDb;
      const user = yield* db.seedUser("company-created");
      yield* addCompany(user.id, { name: db.ids.companyName("created"), orgCode: "CORPORATE" });
      return user.id;
    }),
  },
  company_updated: {
    keys: ["company_id", "before", "after"],
    drive: Effect.gen(function* () {
      const { owner, companyId } = yield* seedOwnedCompany("company-updated");
      yield* updateCompanyInfo(memberForTest(owner.id, companyId, "OWNER"), {
        name: `${P}renamed`,
        orgCode: "CORPORATE",
      });
      return owner.id;
    }),
  },
  company_deleted: {
    keys: ["company_id", "name_at_deletion", "deleted_by_user_id"],
    drive: Effect.gen(function* () {
      const { db, owner, companyId } = yield* seedOwnedCompany("company-deleted");
      yield* db.seedMembership(owner.id, yield* db.seedCompany("company-deleted-kept"), "OWNER");
      yield* deleteCompany(memberForTest(owner.id, companyId, "OWNER"));
      return owner.id;
    }),
  },
  invitation_sent: {
    keys: ["invitation_id", "company_id", "invited_email", "role", "invited_by_user_id"],
    drive: Effect.gen(function* () {
      const { db, owner, companyId } = yield* seedOwnedCompany("invitation-sent");
      yield* createInvitation(
        inviteGrantForTest({
          actorUserId: owner.id,
          companyId,
          email: db.ids.email("invitation-sent-invitee"),
          role: "MEMBER",
        }),
      );
      return owner.id;
    }),
  },
  invitation_accepted: {
    keys: ["invitation_id", "company_id", "accepted_by_user_id", "role"],
    drive: Effect.gen(function* () {
      const { invitee, invitation } = yield* seedInvitationTo(
        "invitation-accepted",
        "MEMBER",
        "OWNER",
      );
      yield* acceptInvitation(acceptGrantForTest({ actor: invitee, invitation }));
      return invitee.id;
    }),
  },
  invitation_revoked: {
    keys: ["invitation_id", "company_id", "revoked_by_user_id"],
    drive: Effect.gen(function* () {
      const { owner, companyId, invitationId } = yield* seedInvitationTo(
        "invitation-revoked",
        "MEMBER",
        "OWNER",
      );
      yield* revokeInvitation(memberForTest(owner.id, companyId, "ADMIN"), invitationId);
      return owner.id;
    }),
  },
  invitation_accept_rejected: {
    keys: [
      "invitation_id",
      "company_id",
      "invited_by_user_id",
      "attempted_role",
      "inviter",
      "reason",
    ],
    drive: Effect.gen(function* () {
      const { invitee, invitation } = yield* seedInvitationTo(
        "invitation-accept-rejected",
        "OWNER",
        "ADMIN",
      );
      yield* withSpy(
        () => spyOn(console, "warn").mockImplementation(() => {}),
        () => Effect.flip(acceptInvitation(acceptGrantForTest({ actor: invitee, invitation }))),
      );
      return invitee.id;
    }),
  },
  membership_removed: {
    keys: ["company_id", "removed_user_id", "removed_by_user_id", "role_at_removal", "was_self"],
    drive: Effect.gen(function* () {
      const { db, owner, companyId } = yield* seedOwnedCompany("membership-removed");
      const member = yield* db.seedUser("membership-removed-member");
      yield* db.seedMembership(member.id, companyId, "MEMBER");
      yield* removeMember(
        removalGrantForTest({
          actorUserId: owner.id,
          targetUserId: member.id,
          companyId,
          targetRole: "MEMBER",
        }),
      );
      return owner.id;
    }),
  },
  role_changed: {
    keys: ["company_id", "target_user_id", "before_role", "after_role", "changed_by_user_id"],
    drive: Effect.gen(function* () {
      const { db, owner, companyId } = yield* seedOwnedCompany("role-changed");
      const member = yield* db.seedUser("role-changed-member");
      yield* db.seedMembership(member.id, companyId, "MEMBER");
      yield* changeRole(
        roleChangeGrantForTest({
          actorUserId: owner.id,
          targetUserId: member.id,
          companyId,
          beforeRole: "MEMBER",
          nextRole: "ADMIN",
        }),
      );
      return owner.id;
    }),
  },
  ownership_transferred: {
    keys: ["company_id", "from_user_id", "to_user_id"],
    drive: Effect.gen(function* () {
      const { db, owner, companyId } = yield* seedOwnedCompany("ownership-transferred");
      const admin = yield* db.seedUser("ownership-transferred-admin");
      yield* db.seedMembership(admin.id, companyId, "ADMIN");
      yield* transferOwnership(
        transferGrantForTest({ actorUserId: owner.id, toUserId: admin.id, companyId }),
      );
      return owner.id;
    }),
  },
  company_switched: {
    keys: ["from_company_id", "to_company_id"],
    drive: Effect.gen(function* () {
      const { db, owner } = yield* seedOwnedCompany("company-switched");
      const target = yield* db.seedCompany("company-switched-target");
      yield* db.seedMembership(owner.id, target, "MEMBER");
      yield* switchCurrentCompany({ userId: owner.id, companyId: target });
      return owner.id;
    }),
  },
} satisfies Record<EventType, { keys: readonly string[]; drive: Drive }>;

const sortedKeys = (keys: readonly string[]) => [...keys].sort();

describe("監査ログの payload の key 集合", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("変更前の key 集合の表は 15 種の event を持つ", () => {
    expect(Object.keys(WRITTEN_BEFORE_REFACTOR)).toHaveLength(15);
  });

  test.each(
    Object.entries(WRITTEN_BEFORE_REFACTOR),
  )("%s を use-case から記帳した行の payload は、変更前の record* が書いた key 集合と一致する", (eventType, {
    keys,
    drive,
  }) =>
    run(
      Effect.gen(function* () {
        const userId = yield* drive;
        const rows = yield* auditRowsFor(userId, eventType);
        expect(rows.map((row) => sortedKeys(Object.keys(row.payload as object)))).toEqual([
          sortedKeys(keys),
        ]);
      }),
    ));
});
