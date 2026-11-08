import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { Command, given, message, model, story } from "foldkit/story";

import {
  init,
  Message,
  type Model,
  type Params,
  SendMagicLink,
  type SignKind,
  StartGitHubSignIn,
  update,
} from "../pages/SignInOrSignUp";

const ORIGIN = "https://auth.taimei-code.com";
const PARAMS: Params = { service_name: "taimei", redirect_url: "https://app.taimei-code.com/" };
const VISIT = 3;

const pageOf = (kind: SignKind, params: Params = PARAMS): Model =>
  init({ kind, params, origin: ORIGIN, otherPageHref: "/other", visit: VISIT }).model;

const filled = (kind: SignKind, params: Params = PARAMS): Model => ({
  ...pageOf(kind, params),
  email: "user@example.com",
  name: "山田 太郎",
});

describe("Magic Link の送信", () => {
  test("ログイン画面は redirect_url を callback にして Magic Link を送り、成功で送信済みの表示になる", () => {
    story(
      update,
      given(filled("SignIn")),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectExact(
        SendMagicLink({
          visit: VISIT,
          email: "user@example.com",
          maybeName: Option.none(),
          callbackUrl: "https://app.taimei-code.com/",
        }),
      ),
      Command.resolve(SendMagicLink, Message.SucceededSendMagicLink({ visit: VISIT })),
      model((next) => {
        expect(next.form).toEqual({ _tag: "SentMagicLink" });
        expect(next.magicLink._tag).toBe("Idle");
      }),
    );
  });

  test("新規登録画面は名前を付け、sign_up_url を callback にする", () => {
    story(
      update,
      given(filled("SignUp", { ...PARAMS, sign_up_url: "https://app.taimei-code.com/welcome" })),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectExact(
        SendMagicLink({
          visit: VISIT,
          email: "user@example.com",
          maybeName: Option.some("山田 太郎"),
          callbackUrl: "https://app.taimei-code.com/welcome",
        }),
      ),
      Command.resolve(SendMagicLink, Message.SucceededSendMagicLink({ visit: VISIT })),
    );
  });

  test("招待の token があれば、callback は招待の受諾の URL になる", () => {
    story(
      update,
      given(filled("SignIn", { ...PARAMS, invitation_token: "token-1" })),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectExact(
        SendMagicLink({
          visit: VISIT,
          email: "user@example.com",
          maybeName: Option.none(),
          callbackUrl: `${ORIGIN}/auth/signup/accept-invitation?invitation_token=token-1`,
        }),
      ),
      Command.resolve(SendMagicLink, Message.SucceededSendMagicLink({ visit: VISIT })),
    );
  });

  test("メールアドレスが空なら送らない", () => {
    story(
      update,
      given(pageOf("SignIn")),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectNone(),
    );
  });

  test("新規登録画面は名前が空なら送らない", () => {
    story(
      update,
      given({ ...pageOf("SignUp"), email: "user@example.com" }),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectNone(),
    );
  });

  test("送信中の二重の送信は、Magic Link も GitHub ももう一度は送らない", () => {
    story(
      update,
      given({ ...filled("SignIn"), magicLink: { _tag: "Submitting" } }),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectNone(),
      message(Message.ClickedGitHubSignIn()),
      Command.expectNone(),
    );
  });

  test("古い画面の送信の結果は、今の画面を変えない", () => {
    story(
      update,
      given(filled("SignIn")),
      message(Message.SubmittedMagicLinkForm()),
      Command.resolve(SendMagicLink, Message.SucceededSendMagicLink({ visit: VISIT - 1 })),
      model((next) => {
        expect(next.form._tag).toBe("Editing");
        expect(next.magicLink._tag).toBe("Submitting");
      }),
    );
  });

  test("送信の失敗は文言を残し、もう一度送れる", () => {
    story(
      update,
      given(filled("SignIn")),
      message(Message.SubmittedMagicLinkForm()),
      Command.resolve(
        SendMagicLink,
        Message.FailedSendMagicLink({ visit: VISIT, message: "送れませんでした" }),
      ),
      model((next) => {
        expect(next.magicLink).toEqual({ _tag: "Rejected", message: "送れませんでした" });
      }),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectExact(SendMagicLink),
      Command.resolve(SendMagicLink, Message.SucceededSendMagicLink({ visit: VISIT })),
    );
  });
});

describe("GitHub での認証", () => {
  test("GitHub を始めると Magic Link の失敗の文言を消し、失敗すると GitHub の文言を出す", () => {
    story(
      update,
      given({ ...filled("SignIn"), magicLink: { _tag: "Rejected", message: "前の失敗" } }),
      message(Message.ClickedGitHubSignIn()),
      Command.expectExact(
        StartGitHubSignIn({
          visit: VISIT,
          callbackUrl: "https://app.taimei-code.com/",
          failedMessage: "GitHub ログインに失敗しました",
        }),
      ),
      model((next) => {
        expect(next.magicLink._tag).toBe("Idle");
        expect(next.gitHub._tag).toBe("Submitting");
      }),
      Command.resolve(
        StartGitHubSignIn,
        Message.FailedStartGitHubSignIn({ visit: VISIT, message: "GitHub ログインに失敗しました" }),
      ),
      model((next) => {
        expect(next.gitHub).toEqual({ _tag: "Rejected", message: "GitHub ログインに失敗しました" });
      }),
    );
  });

  test("新規登録画面の GitHub の失敗の既定の文言はサインアップの文言", () => {
    story(
      update,
      given(filled("SignUp")),
      message(Message.ClickedGitHubSignIn()),
      Command.expectExact(
        StartGitHubSignIn({
          visit: VISIT,
          callbackUrl: "https://app.taimei-code.com/",
          failedMessage: "GitHub サインアップに失敗しました",
        }),
      ),
      Command.resolve(StartGitHubSignIn, Message.SucceededStartGitHubSignIn()),
      model((next) => {
        expect(next.gitHub._tag).toBe("Submitting");
      }),
    );
  });
});
