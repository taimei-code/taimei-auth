import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { resolveInvitationEmailContext } from "../resolve-email-context";

// magic link URL の callbackURL に invitation_token が載っていれば招待メール文脈
// (company 名 / 招待者 / roleLabel) を DB から解決する分岐の統合テスト。
// null を返すと通常 magic link メールへ fallback するため、null 側の分岐も固定する。

const P = "rec-test-";
const helpers = createSeedHelpers(P);

const magicLinkUrl = (callbackURL: string) =>
  `http://auth.taimei-code.local:3100/api/auth/magic-link/verify?token=tok-123&callbackURL=${encodeURIComponent(callbackURL)}`;

const inviteCallback = (token: string) =>
  `/auth/signup/accept-invitation?invitation_token=${encodeURIComponent(token)}`;

describe("resolveInvitationEmailContext", () => {
  beforeEach(helpers.cleanup);
  afterAll(helpers.cleanup);

  const seedInvite = async (role: "OWNER" | "ADMIN" | "MEMBER") => {
    const inviter = await helpers.seedUser("inviter", { name: "招待 花子" });
    const companyId = await helpers.seedCompany("main");
    await helpers.seedMembership(inviter.id, companyId, "OWNER");
    const invitation = await helpers.seedInvitation({
      companyId,
      email: `${P}invitee@example.com`,
      role,
      invitedByUserId: inviter.id,
    });
    return { inviter, invitation };
  };

  test("有効な invitation_token は company 名 / 招待者 / roleLabel を解決する", async () => {
    const { inviter, invitation } = await seedInvite("ADMIN");

    const context = await resolveInvitationEmailContext(
      magicLinkUrl(inviteCallback(invitation.token)),
    );

    expect(context).toEqual({
      companyName: `${P}co-main`,
      inviterName: "招待 花子",
      inviterEmail: inviter.email,
      roleLabel: "管理者",
    });
  });

  test.each([
    ["OWNER", "オーナー"],
    ["MEMBER", "メンバー"],
  ] as const)("role %s の roleLabel は %s", async (role, label) => {
    const { invitation } = await seedInvite(role);

    const context = await resolveInvitationEmailContext(
      magicLinkUrl(inviteCallback(invitation.token)),
    );
    expect(context?.roleLabel).toBe(label);
  });

  test("callbackURL に invitation_token が無ければ null (通常 magic link メール)", async () => {
    expect(await resolveInvitationEmailContext(magicLinkUrl("/account"))).toBeNull();
  });

  test("invitation_token が DB に存在しなければ null", async () => {
    expect(
      await resolveInvitationEmailContext(magicLinkUrl(inviteCallback("no-such-token"))),
    ).toBeNull();
  });

  test("javascript: スキームの callbackURL は invitation 文脈として扱わない", async () => {
    const { invitation } = await seedInvite("MEMBER");

    const context = await resolveInvitationEmailContext(
      magicLinkUrl(`javascript:alert(1)?invitation_token=${invitation.token}`),
    );
    expect(context).toBeNull();
  });

  // inviter 不在時の空文字継続 / company 不在時の null は、invitation の FK (invited_by_user_id /
  // company_id とも onDelete: cascade) により invitation 行が残ったまま参照先だけ消える状態を
  // DB 上作れないため、実装側の防御的分岐としてテスト対象外とする。
});
