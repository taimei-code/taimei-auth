import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { fromString } from "foldkit/url";

import { urlToAuthRoute } from "../auth/route";

const acceptInvitationRouteOf = (search: string) =>
  urlToAuthRoute(
    Option.getOrThrowWith(
      fromString(
        `https://auth.taimei-code.com/auth/signup/accept-invitation?invitation_token=tok${search}`,
      ),
      () => new Error("URL として読めない"),
    ),
  );

describe("招待の受諾の route は、受諾の後の戻り先を決めて渡す", () => {
  test.each([
    { label: "戻り先の組が無い", search: "" },
    {
      label: "戻り先が許可の外",
      search: `&service_name=taimei&redirect_url=${encodeURIComponent("https://evil.example.com/")}`,
    },
    { label: "service_name だけ", search: "&service_name=taimei" },
  ])("$label search では /account を渡す", ({ search }) => {
    expect(acceptInvitationRouteOf(search)).toEqual({
      _tag: "AcceptInvitation",
      invitation_token: "tok",
      redirect_url: "/account",
    });
  });

  test("許可された組の search では、その redirect_url を渡す", () => {
    expect(
      acceptInvitationRouteOf(
        `&service_name=taimei&redirect_url=${encodeURIComponent("https://app.taimei-code.com/dashboard")}`,
      ),
    ).toEqual({
      _tag: "AcceptInvitation",
      invitation_token: "tok",
      redirect_url: "https://app.taimei-code.com/dashboard",
    });
  });
});
