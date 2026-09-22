import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { toDisplayText } from "../../email/sanitize";
import { acceptInvitationPath } from "../accept-path";
import { resolveInvitationEmailContext } from "../resolve-email-context";

const P = "rec-test-";
const { run, cleanup } = dbTest(P);

const magicLinkUrl = (callbackURL: string) =>
  `http://auth.taimei-code.local:3100/api/auth/magic-link/verify?token=tok-123&callbackURL=${encodeURIComponent(callbackURL)}`;

const inviteCallback = acceptInvitationPath;

const seedInvite = (role: "OWNER" | "ADMIN" | "MEMBER", inviterName = "招待 花子") =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const inviter = yield* db.seedUser("inviter", { name: inviterName });
    const companyId = yield* db.seedCompany("main");
    yield* db.seedMembership(inviter.id, companyId, "OWNER");
    const invitation = yield* db.seedInvitation({
      companyId,
      email: `${P}invitee@example.com`,
      role,
      invitedByUserId: inviter.id,
    });
    return { inviter, invitation };
  });

describe("resolveInvitationEmailContext", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("有効な invitation_token は company 名 / 招待者 / roleLabel を解決する", () =>
    run(
      Effect.gen(function* () {
        const { inviter, invitation } = yield* seedInvite("ADMIN");

        const context = yield* resolveInvitationEmailContext(
          magicLinkUrl(inviteCallback(invitation.token)),
        );

        expect(context).toEqual({
          companyName: toDisplayText(`${P}co-main`),
          inviterName: toDisplayText("招待 花子"),
          inviterEmail: toDisplayText(inviter.email),
          roleLabel: "管理者",
        });
      }),
    ));

  test.each([
    ["OWNER", "オーナー"],
    ["MEMBER", "メンバー"],
  ] as const)("role %s の roleLabel は %s", (role, label) =>
    run(
      Effect.gen(function* () {
        const { invitation } = yield* seedInvite(role);

        const context = yield* resolveInvitationEmailContext(
          magicLinkUrl(inviteCallback(invitation.token)),
        );
        expect(context?.roleLabel).toBe(label);
      }),
    ));

  test("招待者名の制御文字は resolveInvitationEmailContext で除去され DisplayText として返る", () =>
    run(
      Effect.gen(function* () {
        const { invitation } = yield* seedInvite("MEMBER", "招待\r\n花子");

        const context = yield* resolveInvitationEmailContext(
          magicLinkUrl(inviteCallback(invitation.token)),
        );
        expect(context?.inviterName).toBe(toDisplayText("招待花子"));
      }),
    ));

  test("callbackURL に invitation_token が無ければ null (通常 magic link メール)", () =>
    run(
      Effect.gen(function* () {
        expect(yield* resolveInvitationEmailContext(magicLinkUrl("/account"))).toBeNull();
      }),
    ));

  test("invitation_token が DB に存在しなければ null", () =>
    run(
      Effect.gen(function* () {
        expect(
          yield* resolveInvitationEmailContext(magicLinkUrl(inviteCallback("no-such-token"))),
        ).toBeNull();
      }),
    ));

  test("javascript: スキームの callbackURL は invitation 文脈として扱わない", () =>
    run(
      Effect.gen(function* () {
        const { invitation } = yield* seedInvite("MEMBER");

        const context = yield* resolveInvitationEmailContext(
          magicLinkUrl(`javascript:alert(1)?invitation_token=${invitation.token}`),
        );
        expect(context).toBeNull();
      }),
    ));
});
