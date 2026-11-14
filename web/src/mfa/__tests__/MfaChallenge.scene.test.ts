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

import { init, Message, type Model, update, VerifyCode, view } from "../pages/MfaChallenge";

const SIGN_IN_HREF =
  "/auth?service_name=accounts&redirect_url=https%3A%2F%2Fauth.example.com%2Faccount";

const observing = (): Model => init({ visit: 1, signInHref: SIGN_IN_HREF }).model;

const entering = (): Model => ({
  ...observing(),
  phase: { _tag: "Entering", kind: "totp", code: "", submission: { _tag: "Idle" } },
});

const codeInput = label("確認コード");

describe("MFA チャレンジの画面", () => {
  test("読み込みの間は status だけを出す", () => {
    scene(
      { update, view },
      given(observing()),
      expect(role("status")).toExist(),
      expect(codeInput).toBeAbsent(),
      expect(role("button", { name: "ログインを続ける" })).toBeAbsent(),
    );
  });

  test("期限切れでは案内とログイン画面への link を出す", () => {
    scene(
      { update, view },
      given({ ...observing(), phase: { _tag: "Expired" } }),
      expect(
        text("セッションの有効期限が切れました。お手数ですが、もう一度ログインしてください。"),
      ).toExist(),
      expect(role("link", { name: "ログイン画面へ" })).toHaveAttr("href", SIGN_IN_HREF),
      expect(codeInput).toBeAbsent(),
    );
  });

  test("入力欄は数字キーボードと OTP の自動入力の属性を持ち、hint を説明に結ぶ", () => {
    scene(
      { update, view },
      given(entering()),
      expect(codeInput).toHaveAttr("autocomplete", "one-time-code"),
      expect(codeInput).toHaveAttr("inputmode", "numeric"),
      expect(codeInput).toHaveAttr("aria-invalid", "false"),
      expect(codeInput).toHaveAttr("aria-describedby", "mfa-challenge-code-hint"),
      expect(role("button", { name: "ログインを続ける" })).toBeDisabled(),
      expect(role("link", { name: "ログインをやり直す" })).toHaveAttr("href", SIGN_IN_HREF),
    );
  });

  test("送信中は入力と切り替えを止め、誤りは alert で出して説明に結ぶ", () => {
    scene(
      { update, view },
      given(entering()),
      type(codeInput, "123456"),
      submit(role("form")),
      expect(codeInput).toBeDisabled(),
      expect(role("button", { name: "ログインを続ける" })).toBeDisabled(),
      expect(role("button", { name: "リカバリーコードを使う" })).toBeDisabled(),
      Command.resolve(VerifyCode, Message.FailedVerifyCode({ visit: 1, failure: "InvalidCode" })),
      expect(role("alert")).toHaveText("入力されたコードが正しくありません。"),
      expect(codeInput).toHaveAttr("aria-invalid", "true"),
      expect(codeInput).toHaveAttr(
        "aria-describedby",
        "mfa-challenge-code-hint mfa-challenge-code-error",
      ),
    );
  });

  test("リカバリーコードに切り替えると、文字のキーボードにして誤りを消す", () => {
    scene(
      { update, view },
      given({
        ...observing(),
        phase: {
          _tag: "Entering",
          kind: "totp",
          code: "1",
          submission: { _tag: "Rejected", message: "誤り" },
        },
      }),
      click(role("button", { name: "リカバリーコードを使う" })),
      expect(label("リカバリーコード")).toHaveAttr("inputmode", "text"),
      expect(label("リカバリーコード")).toHaveValue(""),
      expect(role("alert")).toBeAbsent(),
    );
  });
});
