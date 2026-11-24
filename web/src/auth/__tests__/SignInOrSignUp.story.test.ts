import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  Command,
  expectNoOutMessage,
  expectOutMessage,
  given,
  message,
  model,
  story,
} from "foldkit/story";

import { PASSKEY_SIGN_IN_FAILED_MESSAGE, PasskeySignIn } from "../../passkey/passkey-sign-in";
import {
  FocusMagicLinkField,
  init,
  LoadPasskeyEntry,
  Message,
  OutMessage,
  type Model,
  type Params,
  SendMagicLink,
  SignInWithPasskey,
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

  test("再認証の入口は名前を付けず、redirect_url を callback にする", () => {
    story(
      update,
      given(
        filled("Reauthenticate", { ...PARAMS, sign_up_url: "https://app.taimei-code.com/welcome" }),
      ),
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

  test("メールアドレスが空なら送らず、誤りを示してメールアドレスの欄へ focus する", () => {
    story(
      update,
      given(pageOf("SignIn")),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectExact(FocusMagicLinkField),
      model((current) => {
        expect(current.showsRequiredErrors).toBe(true);
      }),
      Command.resolve(FocusMagicLinkField, Message.CompletedFocusField()),
    );
  });

  test("新規登録画面は名前が空なら送らず、名前の欄へ focus する", () => {
    story(
      update,
      given({ ...pageOf("SignUp"), email: "user@example.com" }),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectExact(FocusMagicLinkField),
      Command.resolve(FocusMagicLinkField, Message.CompletedFocusField()),
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

  test("再認証の入口の GitHub は、redirect_url を callback にしてログインの文言で始める", () => {
    story(
      update,
      given(filled("Reauthenticate")),
      message(Message.ClickedGitHubSignIn()),
      Command.expectExact(
        StartGitHubSignIn({
          visit: VISIT,
          callbackUrl: "https://app.taimei-code.com/",
          failedMessage: "GitHub ログインに失敗しました",
        }),
      ),
      Command.resolve(StartGitHubSignIn, Message.SucceededStartGitHubSignIn()),
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

const commandNamesOf = (kind: SignKind, params: Params = PARAMS) =>
  (
    init({ kind, params, origin: ORIGIN, otherPageHref: "/other", visit: VISIT }).commands ?? []
  ).map((command) => command.name);

const withPasskeyEntry = (kind: SignKind = "SignIn"): Model =>
  update(pageOf(kind), Message.CompletedLoadPasskeyEntry({ visit: VISIT, isShown: true })).model;

describe("パスキーのログインの入口", () => {
  test("ログイン画面は、開いた時にパスキーの入口を出すかを問い合わせる", () => {
    expect(commandNamesOf("SignIn")).toContain(LoadPasskeyEntry.name);
  });

  test("再認証の入口も、ログイン画面と同じくパスキーの入口を問い合わせる", () => {
    expect(commandNamesOf("Reauthenticate")).toContain(LoadPasskeyEntry.name);
  });

  test("新規登録画面と招待の token を受けたログイン画面は、パスキーの入口を問い合わせない", () => {
    expect(commandNamesOf("SignUp")).not.toContain(LoadPasskeyEntry.name);
    expect(commandNamesOf("SignIn", { ...PARAMS, invitation_token: "token-1" })).not.toContain(
      LoadPasskeyEntry.name,
    );
  });

  test("問い合わせの答えが偽なら、入口を出さない", () => {
    story(
      update,
      given(pageOf("SignIn")),
      message(Message.CompletedLoadPasskeyEntry({ visit: VISIT, isShown: false })),
      model((next) => {
        expect(next.passkey._tag).toBe("Hidden");
      }),
    );
  });

  test("古い画面の問い合わせの答えは、今の画面に入口を出さない", () => {
    story(
      update,
      given(pageOf("SignIn")),
      message(Message.CompletedLoadPasskeyEntry({ visit: VISIT - 1, isShown: true })),
      model((next) => {
        expect(next.passkey._tag).toBe("Hidden");
      }),
    );
  });
});

describe("パスキーでのログイン", () => {
  test("押すと redirect_url を渡してログインし、成功で遷移先を application に渡し、移るまで送信中のままにする", () => {
    story(
      update,
      given(withPasskeyEntry()),
      message(Message.ClickedPasskeySignIn()),
      Command.expectExact(
        SignInWithPasskey({ visit: VISIT, redirectUrl: "https://app.taimei-code.com/" }),
      ),
      Command.resolve(
        SignInWithPasskey,
        Message.CompletedSignInWithPasskey({
          visit: VISIT,
          result: PasskeySignIn.SignedIn({ redirectUrl: "https://app.taimei-code.com/next" }),
        }),
      ),
      model((next) => {
        expect(next.passkey).toEqual({ _tag: "Shown", submission: { _tag: "Submitting" } });
      }),
      expectOutMessage(
        OutMessage.SignedInWithPasskey({ redirectUrl: "https://app.taimei-code.com/next" }),
      ),
    );
  });

  test("送信中にもう一度押しても、Magic Link や GitHub を始めても、二重には送らない", () => {
    story(
      update,
      given(
        update({ ...withPasskeyEntry(), email: "user@example.com" }, Message.ClickedPasskeySignIn())
          .model,
      ),
      message(Message.ClickedPasskeySignIn()),
      Command.expectNone(),
      message(Message.SubmittedMagicLinkForm()),
      Command.expectNone(),
      message(Message.ClickedGitHubSignIn()),
      Command.expectNone(),
    );
  });

  test("取り消しは誤りを出さずに戻し、失敗は理由を区別しない文言を出し、Magic Link を始めると消える", () => {
    story(
      update,
      given({ ...withPasskeyEntry(), email: "user@example.com" }),
      message(Message.ClickedPasskeySignIn()),
      Command.resolve(
        SignInWithPasskey,
        Message.CompletedSignInWithPasskey({ visit: VISIT, result: PasskeySignIn.Cancelled() }),
      ),
      model((next) => {
        expect(next.passkey).toEqual({ _tag: "Shown", submission: { _tag: "Idle" } });
      }),
      expectNoOutMessage(),
      message(Message.ClickedPasskeySignIn()),
      Command.resolve(
        SignInWithPasskey,
        Message.CompletedSignInWithPasskey({ visit: VISIT, result: PasskeySignIn.Failed() }),
      ),
      model((next) => {
        expect(next.passkey).toEqual({
          _tag: "Shown",
          submission: { _tag: "Rejected", message: PASSKEY_SIGN_IN_FAILED_MESSAGE },
        });
      }),
      message(Message.SubmittedMagicLinkForm()),
      Command.resolve(SendMagicLink, Message.SucceededSendMagicLink({ visit: VISIT })),
      model((next) => {
        expect(next.passkey).toEqual({ _tag: "Shown", submission: { _tag: "Idle" } });
        expect(next.form._tag).toBe("SentMagicLink");
      }),
    );
  });

  test("古い画面の取り消しと失敗は、今の画面の状態を変えない", () => {
    for (const result of [PasskeySignIn.Cancelled(), PasskeySignIn.Failed()]) {
      story(
        update,
        given(withPasskeyEntry()),
        message(Message.ClickedPasskeySignIn()),
        Command.resolve(
          SignInWithPasskey,
          Message.CompletedSignInWithPasskey({ visit: VISIT - 1, result }),
        ),
        model((next) => {
          expect(next.passkey).toEqual({ _tag: "Shown", submission: { _tag: "Submitting" } });
        }),
        expectNoOutMessage(),
      );
    }
  });

  test("ログインの途中で別の訪問に移っても、成功したログインは遷移先を application に渡す", () => {
    story(
      update,
      given(pageOf("SignUp")),
      message(
        Message.CompletedSignInWithPasskey({
          visit: VISIT - 1,
          result: PasskeySignIn.SignedIn({ redirectUrl: "https://app.taimei-code.com/" }),
        }),
      ),
      expectOutMessage(
        OutMessage.SignedInWithPasskey({ redirectUrl: "https://app.taimei-code.com/" }),
      ),
    );
  });

  test("入口が出ていない時に押しても、ログインを始めない", () => {
    story(
      update,
      given(pageOf("SignIn")),
      message(Message.ClickedPasskeySignIn()),
      Command.expectNone(),
    );
  });
});
