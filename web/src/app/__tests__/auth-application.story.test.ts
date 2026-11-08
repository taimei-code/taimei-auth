import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { UrlRequest } from "foldkit/navigation";
import { Command, given, message, model, story } from "foldkit/story";
import { fromString, type Url } from "foldkit/url";

import * as SignInOrSignUp from "../../auth/pages/SignInOrSignUp";
import * as SignUpCompany from "../../company/pages/SignUpCompany";
import * as MfaChallenge from "../../mfa/pages/MfaChallenge";
import {
  init,
  LeaveToSignIn,
  LoadDocument,
  Message,
  type Model,
  PushUrl,
  RedirectToInvalidRedirectUrlError,
  ReplaceDocument,
  update,
} from "../auth/main";

const ORIGIN = "https://auth.taimei-code.com";
const SEARCH = new URLSearchParams({
  service_name: "taimei",
  redirect_url: "https://app.taimei-code.com/",
}).toString();

const urlOf = (href: string): Url =>
  Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`));

const modelAt = (path: string): Model => init(urlOf(`${ORIGIN}${path}`)).model;

const commandNamesAt = (path: string) =>
  (init(urlOf(`${ORIGIN}${path}`)).commands ?? []).map((command) => command.name);

const signInOrSignUpOf = (current: Model): SignInOrSignUp.Model => {
  const page = Option.getOrThrowWith(current.maybePage, () => new Error("画面が無い"));
  if (page._tag !== "SignInOrSignUp") {
    throw new Error(`ログイン画面でない: ${page._tag}`);
  }
  return page.model;
};

describe("共通ログイン画面と共通サインアップ画面への入り方", () => {
  test.each([
    "/auth",
    "/auth/signup",
  ])("%s の search が通らなければ、不正なリダイレクト URL のエラー画面へ置き換える", (path) => {
    expect(
      commandNamesAt(
        `${path}?service_name=taimei&redirect_url=${encodeURIComponent("https://evil.example.com/")}`,
      ),
    ).toEqual([RedirectToInvalidRedirectUrlError.name]);
  });

  test("ログイン画面の新規登録への link は、宣言した search だけを持つ", () => {
    expect(signInOrSignUpOf(modelAt(`/auth/?${SEARCH}&error=signin_failed`)).otherPageHref).toBe(
      `/auth/signup?${SEARCH}`,
    );
  });

  test("ログイン画面から新規登録画面へ移ると、入力を引き継がずに画面を作り直す", () => {
    story(
      update,
      given({
        ...modelAt(`/auth?${SEARCH}`),
        maybePage: Option.some({
          _tag: "SignInOrSignUp",
          model: { ...signInOrSignUpOf(modelAt(`/auth?${SEARCH}`)), email: "user@example.com" },
        }),
      }),
      message(Message.ChangedUrl({ url: urlOf(`${ORIGIN}/auth/signup?${SEARCH}`) })),
      model((next) => {
        const page = signInOrSignUpOf(next);
        expect(page.kind).toBe("SignUp");
        expect(page.email).toBe("");
        expect(page.visit).toBe(next.pageVisit);
        expect(page.otherPageHref).toBe(`/auth?${SEARCH}`);
      }),
    );
  });

  test("ログイン画面からほかの画面へ移ると、canary の favicon を外す", () => {
    story(
      update,
      given(modelAt(`/auth?${SEARCH}`)),
      message(Message.ChangedUrl({ url: urlOf(`${ORIGIN}/auth/error`) })),
      Command.expectExact(SignInOrSignUp.RemoveCanaryIcon()),
      Command.resolve(
        SignInOrSignUp.RemoveCanaryIcon,
        SignInOrSignUp.Message.CompletedRemoveCanaryIcon(),
      ),
    );
  });

  test("古い画面の送信の結果は、作り直した画面を変えない", () => {
    const before = modelAt(`/auth?${SEARCH}`);
    story(
      update,
      given(before),
      message(Message.ChangedUrl({ url: urlOf(`${ORIGIN}/auth/signup?${SEARCH}`) })),
      message(
        Message.GotSignInOrSignUpMessage({
          message: SignInOrSignUp.Message.SucceededSendMagicLink({
            visit: signInOrSignUpOf(before).visit,
          }),
        }),
      ),
      model((next) => {
        expect(signInOrSignUpOf(next).form._tag).toBe("Editing");
      }),
    );
  });
});

describe("MFA チャレンジの画面への入り方と出方", () => {
  test("/auth/mfa を開くと状態を読みに行く", () => {
    expect(commandNamesAt("/auth/mfa")).toEqual([MfaChallenge.LoadChallengeState.name]);
  });

  test("戻り先の許可の一覧に無い host でも、ログインのやり直しの link を作って画面を出す", () => {
    const page = Option.getOrThrowWith(
      init(urlOf("https://auth.unlisted.example.net/auth/mfa")).model.maybePage,
      () => new Error("画面が無い"),
    );
    expect(page).toMatchObject({
      _tag: "MfaChallenge",
      model: {
        signInHref: `/auth?service_name=accounts&redirect_url=${encodeURIComponent("https://auth.unlisted.example.net/account")}`,
      },
    });
  });

  test("チャレンジを通ると、戻り先へ document を置き換える", () => {
    const opened = modelAt("/auth/mfa");
    story(
      update,
      given(opened),
      message(
        Message.GotMfaChallengeMessage({
          message: MfaChallenge.Message.FailedLoadChallengeState({ visit: opened.pageVisit }),
        }),
      ),
      message(
        Message.GotMfaChallengeMessage({
          message: MfaChallenge.Message.UpdatedCode({ value: "123456" }),
        }),
      ),
      message(Message.GotMfaChallengeMessage({ message: MfaChallenge.Message.SubmittedCode() })),
      Command.resolve(
        MfaChallenge.VerifyCode,
        MfaChallenge.Message.SucceededVerifyCode({
          visit: opened.pageVisit,
          redirectUrl: "https://app.taimei-code.com/",
        }),
      ),
      Command.expectExact(ReplaceDocument({ href: "https://app.taimei-code.com/" })),
      Command.resolve(ReplaceDocument, Message.CompletedReplaceDocument()),
    );
  });

  test("別の画面へ移った後に届いた古い応答は、捨てる", () => {
    const opened = modelAt("/auth/mfa");
    story(
      update,
      given(opened),
      message(Message.ChangedUrl({ url: urlOf(`${ORIGIN}/auth/error`) })),
      message(
        Message.GotMfaChallengeMessage({
          message: MfaChallenge.Message.SucceededLoadChallengeState({
            visit: opened.pageVisit,
            isPending: false,
          }),
        }),
      ),
      model((next) => {
        expect(next.maybePage).toEqual(Option.none());
      }),
      message(Message.ChangedUrl({ url: urlOf(`${ORIGIN}/auth/mfa`) })),
      Command.resolve(
        MfaChallenge.LoadChallengeState,
        MfaChallenge.Message.SucceededLoadChallengeState({
          visit: opened.pageVisit,
          isPending: false,
        }),
      ),
      model((next) => {
        expect(next.maybePage).toMatchObject(
          Option.some({
            _tag: "MfaChallenge",
            model: { visit: next.pageVisit, phase: { _tag: "Observing" } },
          }),
        );
      }),
    );
  });
});

const signUpCompanyOf = (current: Model): SignUpCompany.Model => {
  const page = Option.getOrThrowWith(current.maybePage, () => new Error("画面が無い"));
  if (page._tag !== "SignUpCompany") {
    throw new Error(`事業所の登録の画面でない: ${page._tag}`);
  }
  return page.model;
};

const signUpCompanyMessage = (message: SignUpCompany.Message) =>
  Message.GotSignUpCompanyMessage({ message });

describe("事業所の登録の画面への入り方と出方", () => {
  test("/auth/signup/company を開くと session を確かめに行く", () => {
    expect(commandNamesAt(`/auth/signup/company?${SEARCH}`)).toEqual([
      SignUpCompany.CheckSession.name,
    ]);
  });

  test.each([
    ["許可された redirect_url", "https://app.taimei-code.com/", `?${SEARCH}`],
    [
      "許可されない redirect_url",
      "/account",
      `?service_name=taimei&redirect_url=${encodeURIComponent("https://evil.example.com/")}`,
    ],
    ["search の無い URL", "/account", ""],
  ])("%s で開くと、戻り先は %s になる", (_, redirectUrl, search) => {
    expect(signUpCompanyOf(modelAt(`/auth/signup/company${search}`)).redirectUrl).toBe(redirectUrl);
  });

  test("session が無ければ、今の URL を戻り先にしてログイン画面へ移る", () => {
    const opened = modelAt(`/auth/signup/company?${SEARCH}`);
    story(
      update,
      given(opened),
      message(
        signUpCompanyMessage(
          SignUpCompany.Message.SucceededCheckSession({
            visit: opened.pageVisit,
            isSignedIn: false,
          }),
        ),
      ),
      Command.expectExact(LeaveToSignIn()),
      Command.resolve(LeaveToSignIn, Message.CompletedLeaveToSignIn()),
    );
  });

  test("所属があれば、戻り先へ document を置き換える", () => {
    const opened = modelAt(`/auth/signup/company?${SEARCH}`);
    story(
      update,
      given(opened),
      message(
        signUpCompanyMessage(
          SignUpCompany.Message.SucceededLoadMemberships({
            visit: opened.pageVisit,
            isCompanyMember: true,
          }),
        ),
      ),
      Command.expectExact(ReplaceDocument({ href: "https://app.taimei-code.com/" })),
      Command.resolve(ReplaceDocument, Message.CompletedReplaceDocument()),
    );
  });

  test("ログアウトの後は、末尾に / の無いログイン画面を読み直す", () => {
    const opened = modelAt(`/auth/signup/company?${SEARCH}`);
    story(
      update,
      given(opened),
      message(
        signUpCompanyMessage(SignUpCompany.Message.FailedCheckSession({ visit: opened.pageVisit })),
      ),
      message(signUpCompanyMessage(SignUpCompany.Message.ClickedSignOut())),
      Command.resolve(
        SignUpCompany.SignOut,
        SignUpCompany.Message.SucceededSignOut({ visit: opened.pageVisit }),
      ),
      Command.expectExact(
        LoadDocument({
          href: `/auth?service_name=accounts&redirect_url=${encodeURIComponent(`${ORIGIN}/account`)}`,
        }),
      ),
      Command.resolve(LoadDocument, Message.CompletedLoadDocument()),
    );
  });

  test("別の画面へ移った後に届いた古い応答は、捨てる", () => {
    const opened = modelAt(`/auth/signup/company?${SEARCH}`);
    story(
      update,
      given(opened),
      message(Message.ChangedUrl({ url: urlOf(`${ORIGIN}/auth/error`) })),
      message(
        signUpCompanyMessage(
          SignUpCompany.Message.SucceededCheckSession({
            visit: opened.pageVisit,
            isSignedIn: false,
          }),
        ),
      ),
      Command.expectNone(),
      model((next) => {
        expect(next.maybePage).toEqual(Option.none());
      }),
    );
  });
});

describe("application の中の link", () => {
  test("同じ application の画面への link は document を読み直さない", () => {
    story(
      update,
      given(modelAt(`/auth?${SEARCH}`)),
      message(
        Message.ClickedLink({
          request: UrlRequest.Internal({ url: urlOf(`${ORIGIN}/auth/signup?${SEARCH}`) }),
        }),
      ),
      Command.expectExact(PushUrl({ href: `${ORIGIN}/auth/signup?${SEARCH}` })),
      Command.resolve(PushUrl, Message.CompletedPushUrl()),
    );
  });

  test("別の application の画面への link は document を読み直す", () => {
    story(
      update,
      given(modelAt(`/auth?${SEARCH}`)),
      message(
        Message.ClickedLink({ request: UrlRequest.Internal({ url: urlOf(`${ORIGIN}/account`) }) }),
      ),
      Command.expectExact(LoadDocument({ href: `${ORIGIN}/account` })),
      Command.resolve(LoadDocument, Message.CompletedLoadDocument()),
    );
  });
});
