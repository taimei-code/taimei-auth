import { describe, test } from "bun:test";
import {
  click,
  Command,
  expect,
  given,
  label,
  role,
  scene,
  submit,
  text,
  type,
} from "foldkit/scene";

import {
  init,
  Message,
  type Params,
  SendMagicLink,
  type SignKind,
  StartGitHubSignIn,
  update,
  view,
} from "../pages/SignInOrSignUp";

const PARAMS: Params = {
  service_name: "accounts",
  redirect_url: "https://auth.taimei-code.com/account",
};

const pageOf = (kind: SignKind, params: Params = PARAMS) =>
  init({
    kind,
    params,
    origin: "https://auth.taimei-code.com",
    otherPageHref: "/other",
    visit: 1,
  }).model;

describe("ログイン画面", () => {
  test("見出し、入力欄、2 つのボタン、新規登録への link を出す", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      expect(text("taimei-auth にログイン")).toExist(),
      expect(label("メールアドレス")).toExist(),
      expect(label("お名前")).toBeAbsent(),
      expect(role("button", { name: "Magic Link を送信" })).toBeDisabled(),
      expect(role("button", { name: "GitHub でログイン" })).toBeEnabled(),
      expect(role("link", { name: "新規登録" })).toHaveAttr("href", "/other"),
    );
  });

  test("送信中は入力とボタンを止め、成功で送信済みの文を出す", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      type(label("メールアドレス"), "user@example.com"),
      submit(role("form")),
      expect(label("メールアドレス")).toBeDisabled(),
      expect(role("button", { name: "Magic Link を送信" })).toBeDisabled(),
      expect(role("button", { name: "GitHub でログイン" })).toBeDisabled(),
      Command.resolve(SendMagicLink, Message.SucceededSendMagicLink({ visit: 1 })),
      expect(text("user@example.com")).toExist(),
      expect(label("メールアドレス")).toBeAbsent(),
    );
  });

  test("送信の失敗の文言を出す", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      type(label("メールアドレス"), "user@example.com"),
      submit(role("form")),
      Command.resolve(
        SendMagicLink,
        Message.FailedSendMagicLink({ visit: 1, message: "Magic Link の送信に失敗しました" }),
      ),
      expect(text("Magic Link の送信に失敗しました")).toExist(),
      expect(role("button", { name: "Magic Link を送信" })).toBeEnabled(),
    );
  });

  test("GitHub での認証の間は Magic Link を止め、失敗すると文言を出す", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      click(role("button", { name: "GitHub でログイン" })),
      expect(role("button", { name: "Magic Link を送信" })).toBeDisabled(),
      expect(role("button", { name: "GitHub でログイン" })).toBeDisabled(),
      Command.resolve(
        StartGitHubSignIn,
        Message.FailedStartGitHubSignIn({ visit: 1, message: "GitHub ログインに失敗しました" }),
      ),
      expect(text("GitHub ログインに失敗しました")).toExist(),
      expect(role("button", { name: "GitHub でログイン" })).toBeEnabled(),
    );
  });

  test("招待の token があると GitHub のボタンを出さない", () => {
    scene(
      { update, view },
      given(pageOf("SignIn", { ...PARAMS, invitation_token: "token-1" })),
      expect(role("button", { name: "GitHub でログイン" })).toBeAbsent(),
      expect(
        text("招待を受諾するには、招待されたメールアドレスで Magic Link をご利用ください。"),
      ).toExist(),
    );
  });
});

describe("新規登録画面", () => {
  test("お名前の欄を出し、両方を入れるまで送れない", () => {
    scene(
      { update, view },
      given(pageOf("SignUp")),
      expect(text("taimei-auth に登録")).toExist(),
      type(label("メールアドレス"), "user@example.com"),
      expect(role("button", { name: "Magic Link で登録" })).toBeDisabled(),
      type(label("お名前"), "山田 太郎"),
      expect(role("button", { name: "Magic Link で登録" })).toBeEnabled(),
      expect(role("link", { name: "ログイン" })).toHaveAttr("href", "/other"),
    );
  });

  test("GitHub で登録を押すと GitHub の認証を始める", () => {
    scene(
      { update, view },
      given(pageOf("SignUp")),
      click(role("button", { name: "GitHub で登録" })),
      Command.expectExact(StartGitHubSignIn),
      Command.resolve(StartGitHubSignIn, Message.SucceededStartGitHubSignIn()),
      expect(role("button", { name: "GitHub で登録" })).toBeDisabled(),
    );
  });
});
