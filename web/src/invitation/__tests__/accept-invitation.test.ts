import { describe, expect, mock, test } from "bun:test";
import { Exit } from "effect";

import { ExpiredOrUsed } from "@core/membership/guard/errors";

import { acceptInvitationOutcome } from "../accept-invitation";
import { acceptInvitationSearchSchema } from "../redirect-target";

const searchWith = (params: Record<string, string>) => acceptInvitationSearchSchema.parse(params);
const accepted = Exit.succeed({ ok: true as const, company_id: "company-1" });

describe("acceptInvitationOutcome", () => {
  test("招待の token が無ければ、token が見つからない失敗", async () => {
    const accept = mock(async () => accepted);

    const outcome = await acceptInvitationOutcome(searchWith({}), {
      hasSession: async () => true,
      accept,
    });

    expect(outcome).toEqual({ kind: "failed", message: "招待トークンが見つかりません。" });
  });

  test("session が無ければ、受諾せずに sign-in へ", async () => {
    const accept = mock(async () => accepted);

    const outcome = await acceptInvitationOutcome(searchWith({ invitation_token: "tok" }), {
      hasSession: async () => false,
      accept,
    });

    expect(outcome).toEqual({ kind: "signIn" });
    expect(accept).not.toHaveBeenCalled();
  });

  test("受諾が成功し redirect target が無ければ /account へ", async () => {
    const outcome = await acceptInvitationOutcome(searchWith({ invitation_token: "tok" }), {
      hasSession: async () => true,
      accept: async () => accepted,
    });

    expect(outcome).toEqual({ kind: "goToRedirectUrl", redirectUrl: "/account" });
  });

  test("受諾が ExpiredOrUsed で失敗したら、期限切れか使用済みの失敗", async () => {
    const outcome = await acceptInvitationOutcome(searchWith({ invitation_token: "tok" }), {
      hasSession: async () => true,
      accept: async () => Exit.fail(new ExpiredOrUsed()),
    });

    expect(outcome).toEqual({
      kind: "failed",
      message: "この招待は期限切れか、既に使用されています。",
    });
  });
});
