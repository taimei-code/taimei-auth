import { AUTH_ERROR_REASONS } from "@taimei-code/auth-client";

export const ERROR_PAGE_REASONS = [...AUTH_ERROR_REASONS, "invalid_redirect_url"] as const;

export type ErrorPageReason = (typeof ERROR_PAGE_REASONS)[number];

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

export const errorPageMessage = (reason: ErrorPageReason | undefined): ErrorPageMessage =>
  reason === undefined ? DEFAULT_MESSAGE : ERROR_MESSAGES[reason];
