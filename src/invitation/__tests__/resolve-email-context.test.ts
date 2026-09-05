import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { acceptInvitationPath } from "../accept-path";
import { resolveInvitationEmailContext } from "../resolve-email-context";

// magic link URL の callbackURL に invitation_token が載っていれば招待メール文脈
// (company 名 / 招待者 / roleLabel) を DB から解決する分岐の統合テスト。
// null を返すと通常 magic link メールへ fallback するため、null 側の分岐も固定する。

const P = "rec-test-";
const { run, cleanup } = dbTest(P);

const magicLinkUrl = (callbackURL: string) =>
  `http://auth.taimei-code.local:3100/api/auth/magic-link/verify?token=tok-123&callbackURL=${encodeURIComponent(callbackURL)}`;

const inviteCallback = acceptInvitationPath;

const seedInvite = (role: "OWNER" | "ADMIN" | "MEMBER") =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const inviter = yield* db.seedUser("inviter", { name: "招待 花子" });
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
          companyName: `${P}co-main`,
          inviterName: "招待 花子",
          inviterEmail: inviter.email,
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

  test("ADMIN 招待は roleLabel が管理者になる", () =>
    run(
      Effect.gen(function* () {
        const { inviter, invitation } = yield* seedInvite("ADMIN");

        const context = yield* resolveInvitationEmailContext(
          magicLinkUrl(inviteCallback(invitation.token)),
        );

        expect(context).toEqual({
          companyName: `${P}co-main`,
          inviterName: "招待 花子",
          inviterEmail: inviter.email,
          roleLabel: "管理者",
        });
      }),
    ));

  // inviter 不在時の空文字継続 / company 不在時の null は、invitation の FK (invited_by_user_id /
  // company_id とも onDelete: cascade) により invitation 行が残ったまま参照先だけ消える状態を
  // DB 上作れないため、実装側の防御的分岐としてテスト対象外とする。
});
