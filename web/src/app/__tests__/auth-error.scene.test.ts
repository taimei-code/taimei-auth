import { describe, test } from "bun:test";
import { Option } from "effect";
import { expect, given, role, scene } from "foldkit/scene";
import { fromString } from "foldkit/url";

import { init, type Model, update, view } from "../auth/main";

const modelAt = (href: string): Model =>
  init(Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`)))
    .model;

describe("エラー画面は理由ごとの文言を alert で出す", () => {
  test.each([
    [
      "signin_failed",
      "ログインに失敗しました",
      "ログイン処理中にエラーが発生しました。再度お試しください。",
    ],
    [
      "signup_already_completed",
      "サインアップ済みです",
      "既に登録済みのアカウントです。ログイン画面からログインしてください。",
    ],
    [
      "invalid_redirect_url",
      "不正なリダイレクト URL",
      "リダイレクト先が許可されていません。ログインリクエストを発行したサービスから再度ログインしてください。",
    ],
  ])("理由 %s は title と description を出す", (reason, title, description) => {
    scene(
      { update, view },
      given(modelAt(`https://auth.example.com/auth/error?reason=${reason}`)),
      expect(role("alert")).toContainText(title),
      expect(role("alert")).toContainText(description),
    );
  });

  test.each([
    ["定義外の理由", "https://auth.example.com/auth/error?reason=bogus"],
    ["理由なし", "https://auth.example.com/auth/error"],
  ])("%s は既定の文言を出す", (_label, href) => {
    scene(
      { update, view },
      given(modelAt(href)),
      expect(role("alert")).toContainText("エラーが発生しました"),
      expect(role("alert")).toContainText(
        "予期せぬエラーが発生しました。時間を置いて再度お試しください。",
      ),
    );
  });

  test.each([
    ["/auth の下の知らない path", "https://auth.example.com/auth/no-such-page"],
    ["/auth と /account の外の path", "https://auth.example.com/no-such-page"],
    ["root の path", "https://auth.example.com/"],
  ])("%s は既定の文言を出す", (_label, href) => {
    scene(
      { update, view },
      given(modelAt(href)),
      expect(role("alert")).toContainText("エラーが発生しました"),
    );
  });
});
