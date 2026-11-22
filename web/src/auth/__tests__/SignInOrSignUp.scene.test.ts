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

import { PASSKEY_SIGN_IN_FAILED_MESSAGE, PasskeySignIn } from "../../passkey/passkey-sign-in";
import {
  FocusMagicLinkField,
  init,
  Message,
  type Params,
  SendMagicLink,
  SignInWithPasskey,
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
      expect(role("button", { name: "Magic Link を送信" })).toBeEnabled(),
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

describe("必須の欄", () => {
  test("ログインで、メールアドレスが空のまま送信のボタンを押すと、「メールアドレスを入力してください。」が出て、入力欄が aria-invalid になる", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      click(role("button", { name: "Magic Link を送信" })),
      expect(text("メールアドレスを入力してください。")).toExist(),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "true"),
      Command.resolve(FocusMagicLinkField, Message.CompletedFocusField()),
    );
  });

  test("ログインで、空白だけのメールアドレスで送信すると、空と同じ誤りを示す", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      type(label("メールアドレス"), "   "),
      click(role("button", { name: "Magic Link を送信" })),
      expect(text("メールアドレスを入力してください。")).toExist(),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "true"),
      Command.resolve(FocusMagicLinkField, Message.CompletedFocusField()),
    );
  });

  test("触る前の入力欄は aria-invalid が false である", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "false"),
    );
    scene(
      { update, view },
      given(pageOf("SignUp")),
      expect(label("お名前")).toHaveAttr("aria-invalid", "false"),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "false"),
    );
  });

  test("必須の欄は label の隣に印を持ち、form は印が必須を表すことを説明する", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      expect(text("*")).toExist(),
      expect(text("* は必須の項目です。")).toExist(),
    );
  });
});

describe("新規登録画面", () => {
  test("お名前の欄を出し、お名前が空のまま送ると、お名前の欄に誤りを示す", () => {
    scene(
      { update, view },
      given(pageOf("SignUp")),
      expect(text("taimei-auth に登録")).toExist(),
      type(label("メールアドレス"), "user@example.com"),
      click(role("button", { name: "Magic Link で登録" })),
      expect(text("お名前を入力してください。")).toExist(),
      expect(label("お名前")).toHaveAttr("aria-invalid", "true"),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "false"),
      Command.resolve(FocusMagicLinkField, Message.CompletedFocusField()),
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

const withPasskeyEntry = () =>
  update(pageOf("SignIn"), Message.CompletedLoadPasskeyEntry({ visit: 1, isShown: true })).model;

describe("パスキーでログイン", () => {
  test("入口を出さない答えの前は、「パスキーでログイン」を出さない", () => {
    scene(
      { update, view },
      given(pageOf("SignIn")),
      expect(role("button", { name: "パスキーでログイン" })).toBeAbsent(),
    );
  });

  test("ログインの間はほかの経路を止め、失敗すると理由を区別しない文言を alert に出して、また押せる", () => {
    scene(
      { update, view },
      given(withPasskeyEntry()),
      click(role("button", { name: "パスキーでログイン" })),
      expect(role("button", { name: "パスキーでログイン" })).toBeDisabled(),
      expect(role("button", { name: "Magic Link を送信" })).toBeDisabled(),
      expect(role("button", { name: "GitHub でログイン" })).toBeDisabled(),
      Command.resolve(
        SignInWithPasskey,
        Message.CompletedSignInWithPasskey({ visit: 1, result: PasskeySignIn.Failed() }),
      ),
      expect(role("alert")).toHaveText(PASSKEY_SIGN_IN_FAILED_MESSAGE),
      expect(role("button", { name: "パスキーでログイン" })).toBeEnabled(),
      expect(role("button", { name: "Magic Link を送信" })).toBeEnabled(),
    );
  });

  test("取り消すと alert を出さずに、また押せる", () => {
    scene(
      { update, view },
      given(withPasskeyEntry()),
      click(role("button", { name: "パスキーでログイン" })),
      Command.resolve(
        SignInWithPasskey,
        Message.CompletedSignInWithPasskey({ visit: 1, result: PasskeySignIn.Cancelled() }),
      ),
      expect(role("alert")).toBeAbsent(),
      expect(role("button", { name: "パスキーでログイン" })).toBeEnabled(),
    );
  });
});
