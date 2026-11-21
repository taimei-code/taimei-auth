import type { FailureMessages } from "../shared/failure-message";
import type { PasskeyFailure } from "./passkey-registration";

const PASSKEY_GENERIC_FAILURE_MESSAGE =
  "処理に失敗しました。しばらく待ってからもう一度お試しください。";

export const PASSKEY_FAILURE_MESSAGES: FailureMessages<PasskeyFailure> = {
  RateLimited: "操作の回数が上限に達しました。しばらく待ってからもう一度お試しください。",
  TotpRequired: "多要素認証 (MFA) が有効になっています。ページを再読み込みしてください。",
  PasskeyRejected:
    "パスキーを登録できませんでした。時間が経ちすぎた可能性があります。もう一度登録してください。",
  PasskeyAlreadyRegistered: "このパスキーはすでに登録されています。",
  PasskeyRegistrationUnavailable: "パスキーはまだ登録できません。ページを再読み込みしてください。",
  PasskeyLimitReached:
    "登録できるパスキーの数の上限に達しています。ページを再読み込みして、不要なパスキーを削除してください。",
  NotFound: "このパスキーは見つかりませんでした。ページを再読み込みしてください。",
};

export const passkeyFailureText = (
  failure: keyof typeof PASSKEY_FAILURE_MESSAGES | "Unexpected",
): string =>
  failure === "Unexpected" ? PASSKEY_GENERIC_FAILURE_MESSAGE : PASSKEY_FAILURE_MESSAGES[failure];
