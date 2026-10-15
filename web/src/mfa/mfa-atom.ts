import { useAtomSet } from "@effect/atom-react";
import type { Cause } from "effect";
import { Exit } from "effect";
import type { Atom } from "effect/reactivity";

import { type FailureMessages, failureMessage } from "../shared/failure-message";
import { SpaApiClient } from "../shared/spa-api-client";
import type { MfaChallengeObservation } from "./mfa-challenge-flow";

import type { MfaCodeKind } from "@core/mfa/mfa-contract";

export type { MfaCodeKind };

export const mfaStatusAtom = SpaApiClient.query("mfa", "status", {});
const enrollMfaAtom = SpaApiClient.mutation("mfa", "enroll");
const activateMfaAtom = SpaApiClient.mutation("mfa", "activate");
const disableMfaAtom = SpaApiClient.mutation("mfa", "disable");

export const mfaChallengeStateAtom = SpaApiClient.query("mfaChallenge", "state", {});
const verifyMfaChallengeAtom = SpaApiClient.mutation("mfaChallenge", "verify");

export type MfaFailure = Atom.Failure<
  | typeof enrollMfaAtom
  | typeof activateMfaAtom
  | typeof disableMfaAtom
  | typeof verifyMfaChallengeAtom
>;

const GENERIC_MESSAGE = "処理に失敗しました。しばらく待ってからもう一度お試しください。";

export const MFA_FAILURE_MESSAGES: FailureMessages<MfaFailure> = {
  InvalidCode: "入力されたコードが正しくありません。",
  ChallengeExpired: "ログインの有効期限が切れました。お手数ですが、もう一度ログインしてください。",
  Locked:
    "試行回数が上限に達したか、確認を一時的に受け付けられません。15 分ほど経ってからやり直してください。",
  RateLimited: "操作の回数が上限に達しました。しばらく待ってからもう一度お試しください。",
  AlreadyEnabled: "多要素認証 (MFA) はすでに有効です。ページを再読み込みしてください。",
  EnrollmentChanged: "登録情報が更新されました。もう一度登録を開始してください。",
  NotEnabled: "多要素認証 (MFA) は有効になっていません。ページを再読み込みしてください。",
  MfaNotFound: GENERIC_MESSAGE,
};

export const mfaFailureMessage = (cause: Cause.Cause<MfaFailure>): string =>
  failureMessage(cause, MFA_FAILURE_MESSAGES, GENERIC_MESSAGE);

export const useEnrollMfa = () => {
  const enroll = useAtomSet(enrollMfaAtom, { mode: "promiseExit" });
  return () => enroll({});
};

export const useActivateMfa = () => {
  const activate = useAtomSet(activateMfaAtom, { mode: "promiseExit" });
  return (payload: { code: string; enrollment_id: string }) => activate({ payload });
};

export const useDisableMfa = () => {
  const disable = useAtomSet(disableMfaAtom, { mode: "promiseExit" });
  return (payload: { code: string; kind: MfaCodeKind }) => disable({ payload });
};

export const useVerifyMfaChallenge = () => {
  const verify = useAtomSet(verifyMfaChallengeAtom, { mode: "promiseExit" });
  return (payload: { code: string; kind: MfaCodeKind }) => verify({ payload });
};

export const mfaChallengeObservationOf = (
  state: Exit.Exit<{ readonly pending: boolean }, unknown>,
): MfaChallengeObservation =>
  Exit.match(state, {
    onSuccess: ({ pending }) => (pending ? { kind: "present" } : { kind: "absent" }),
    onFailure: () => ({ kind: "unavailable" }),
  });
