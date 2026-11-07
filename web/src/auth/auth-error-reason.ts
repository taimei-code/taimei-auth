import { AUTH_ERROR_REASONS } from "@taimei-code/auth-client";
import { Option, Schema } from "effect";

export const ErrorPageReason = Schema.Literals([...AUTH_ERROR_REASONS, "invalid_redirect_url"]);

export type ErrorPageReason = typeof ErrorPageReason.Type;

type ErrorPageMessage = { readonly title: string; readonly description: string };

const ERROR_MESSAGES: Record<ErrorPageReason, ErrorPageMessage> = {
  invalid_redirect_url: {
    title: "不正なリダイレクト URL",
    description:
      "リダイレクト先が許可されていません。ログインリクエストを発行したサービスから再度ログインしてください。",
  },
  signup_already_completed: {
    title: "サインアップ済みです",
    description: "既に登録済みのアカウントです。ログイン画面からログインしてください。",
  },
  signin_failed: {
    title: "ログインに失敗しました",
    description: "ログイン処理中にエラーが発生しました。再度お試しください。",
  },
};

const DEFAULT_MESSAGE: ErrorPageMessage = {
  title: "エラーが発生しました",
  description: "予期せぬエラーが発生しました。時間を置いて再度お試しください。",
};

export const errorPageMessage = (maybeReason: Option.Option<ErrorPageReason>): ErrorPageMessage =>
  Option.match(maybeReason, {
    onNone: () => DEFAULT_MESSAGE,
    onSome: (reason) => ERROR_MESSAGES[reason],
  });
