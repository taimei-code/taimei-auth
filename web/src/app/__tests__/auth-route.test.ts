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

const authRouteOf = (pathAndSearch: string) =>
  urlToAuthRoute(
    Option.getOrThrowWith(
      fromString(`https://auth.taimei-code.com${pathAndSearch}`),
      () => new Error("URL として読めない"),
    ),
  );

const ALLOWED_REDIRECT = "https://auth.taimei-code.com/account";
const redirectOfLength = (length: number) => {
  const base = `${ALLOWED_REDIRECT}?p=`;
  return base + "a".repeat(length - base.length);
};

describe("ログインの画面の route は、consumer が渡す query を検査して、通らなければ query を拒んだ画面にする", () => {
  test("許可された query は、宣言していない key を落としたログインの画面になる", () => {
    expect(
      authRouteOf(
        `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(ALLOWED_REDIRECT)}&error=signin_failed`,
      ),
    ).toEqual({ _tag: "SignIn", service_name: "accounts", redirect_url: ALLOWED_REDIRECT });
  });

  test("redirect_url は 2048 文字までログインの画面になる", () => {
    expect(
      authRouteOf(
        `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(redirectOfLength(2048))}`,
      ),
    ).toEqual({ _tag: "SignIn", service_name: "accounts", redirect_url: redirectOfLength(2048) });
  });

  test.each([
    {
      label: "許可の外の redirect_url",
      search: `service_name=accounts&redirect_url=${encodeURIComponent("https://evil.example.com/")}`,
    },
    {
      label: "2049 文字の redirect_url",
      search: `service_name=accounts&redirect_url=${encodeURIComponent(redirectOfLength(2049))}`,
    },
    { label: "空の redirect_url", search: "service_name=accounts&redirect_url=" },
    {
      label: "未知の service_name",
      search: `service_name=nazo&redirect_url=${encodeURIComponent(ALLOWED_REDIRECT)}`,
    },
  ])("$label は query を拒んだ画面になる", ({ search }) => {
    expect(authRouteOf(`/auth/?${search}`)).toEqual({ _tag: "RejectedSignInParams" });
  });
});

describe("事業所作成の画面の route は、query が不正でも戻り先をアカウント画面にして開く", () => {
  test.each([
    { label: "query が無い", search: "" },
    {
      label: "許可の外の redirect_url",
      search: `?service_name=taimei&redirect_url=${encodeURIComponent("https://evil.example.com/")}`,
    },
  ])("$label: 戻り先を accounts と /account にする", ({ search }) => {
    expect(authRouteOf(`/auth/signup/company${search}`)).toEqual({
      _tag: "SignUpCompany",
      service_name: "accounts",
      redirect_url: "/account",
    });
  });
});

describe("招待の受諾の route は、招待の token が無くても受諾の画面にする", () => {
  test("invitation_token の無い search では、token の無い受諾の画面になる", () => {
    expect(authRouteOf("/auth/signup/accept-invitation")).toEqual({
      _tag: "AcceptInvitation",
      invitation_token: undefined,
      redirect_url: "/account",
    });
  });
});

describe("再認証の画面の route は、戻り先がアカウント画面の許可に入るときだけ開く", () => {
  test("許可された redirect_url は再認証の画面になる", () => {
    expect(
      authRouteOf(`/auth/reauthenticate?redirect_url=${encodeURIComponent(ALLOWED_REDIRECT)}`),
    ).toEqual({ _tag: "Reauthenticate", redirect_url: ALLOWED_REDIRECT });
  });

  test("再認証の戻り先が許可の外なら query を拒んだ画面になる", () => {
    expect(
      authRouteOf(
        `/auth/reauthenticate?redirect_url=${encodeURIComponent("https://evil.example.com/")}`,
      ),
    ).toEqual({ _tag: "RejectedSignInParams" });
  });
});
