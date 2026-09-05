import { expect, test } from "bun:test";
import type { Effect } from "effect";
import type { Actor } from "../../../membership/guard/core";
import type {
  MfaChallengeStateResponse,
  MfaChallengeVerifyResponse,
  MfaEnrollResponse,
  MfaErrorResponse,
  MfaOkResponse,
  MfaStatusResponse,
  MfaWireErrorCode,
} from "../../wire-contracts";
import type { MfaTotpActor } from "../contracts";

// 契約検出器 (§10-5)。runtime import なし (typeof import) — façade の入出力が handler の呼び出しと
// wire response 構築を無変更で通ることを typecheck で固定する。壊れたらこのファイルが赤くなる。

type Facade = typeof import("../index");

// guard の Actor はそのまま façade へ渡せる。
const _actorCompat: (actor: Actor) => MfaTotpActor = (actor) => actor;

type EnrollOk = Effect.Success<ReturnType<Facade["enroll"]>>;
const _enrollWire = (r: EnrollOk): MfaEnrollResponse => ({
  totp_uri: r.totpUri,
  recovery_codes: r.recoveryCodes,
  enrollment_id: r.enrollmentId,
});

type StatusResult = Effect.Success<ReturnType<Facade["readOwnedMfaStatus"]>>;
const _statusWire = (r: StatusResult): MfaStatusResponse => ({
  enabled: r.enabled,
  // in_effect ≡ enabled の恒等写像 (handler と同じ 1 行)。
  in_effect: r.enabled,
  recovery_codes_remaining: r.recoveryCodesRemaining,
});

type ActivateOk = Effect.Success<ReturnType<Facade["activate"]>>;
type DisableOk = Effect.Success<ReturnType<Facade["disable"]>>;
const _activateForward = (r: ActivateOk): Headers => r.sessionChanges;
const _disableForward = (r: DisableOk): Headers => r.sessionChanges;
const _okBody: MfaOkResponse = { ok: true };

// 失敗枝のうち MFA 語彙を持つ failure class は adapter が 1 行で HTTP に落とせる形 ({ error, status })。
// boundary error (DbError / AuthApiError / RedisError) はここに現れず 500 へ落ちる。
type ActivateFailure = Extract<
  Effect.Error<ReturnType<Facade["activate"]>>,
  { error: MfaWireErrorCode }
>;
const _failureWire = (r: ActivateFailure): MfaErrorResponse => ({ error: r.error });
const _failureStatus = (r: ActivateFailure): number => r.status;

// チャレンジ 2 依存の入出力互換。
type ChallengeState = Effect.Success<ReturnType<Facade["readLoginChallengeState"]>>;
const _challengeStateWire = (r: ChallengeState): MfaChallengeStateResponse => r;

type CompletionOk = Effect.Success<ReturnType<Facade["completeLoginChallenge"]>>;
const _completionWire = (r: CompletionOk): MfaChallengeVerifyResponse => ({
  redirect_url: r.redirectUrl,
});
const _completionForward = (r: CompletionOk): Headers => r.forwardedHeaders;

test("契約検出器は typecheck で機能する (runtime 検証なし)", () => {
  expect(true).toBe(true);
});
