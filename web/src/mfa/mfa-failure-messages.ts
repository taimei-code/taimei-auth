import type { FailureMessages } from "../shared/failure-message";
import type { DeclaredFailure } from "../shared/spa-http-client";

export type MfaFailure =
  | DeclaredFailure<"mfa", "enroll">
  | DeclaredFailure<"mfa", "activate">
  | DeclaredFailure<"mfa", "disable">
  | DeclaredFailure<"mfaChallenge", "verify">;

export const MFA_GENERIC_FAILURE_MESSAGE =
  "処理に失敗しました。しばらく待ってからもう一度お試しください。";

export const MFA_FAILURE_MESSAGES: FailureMessages<MfaFailure> = {
  InvalidCode: "入力されたコードが正しくありません。",
  ChallengeExpired: "ログインの有効期限が切れました。お手数ですが、もう一度ログインしてください。",
  Locked:
    "試行回数が上限に達したか、確認を一時的に受け付けられません。15 分ほど経ってからやり直してください。",
  RateLimited: "操作の回数が上限に達しました。しばらく待ってからもう一度お試しください。",
  AlreadyEnabled: "多要素認証 (MFA) はすでに有効です。ページを再読み込みしてください。",
  EnrollmentChanged: "登録情報が更新されました。もう一度登録を開始してください。",
  NotEnabled: "多要素認証 (MFA) は有効になっていません。ページを再読み込みしてください。",
  MfaNotFound: MFA_GENERIC_FAILURE_MESSAGE,
};
