import { expect, test } from "bun:test";
import type { Actor } from "../../../membership/guard/core";
import type {
  MfaChallengeStateResponse,
  MfaChallengeVerifyResponse,
  MfaEnrollResponse,
  MfaErrorResponse,
  MfaOkResponse,
  MfaStatusResponse,
} from "../../wire-contracts";
import type { MfaTotpActor } from "../contracts";

// 契約検出器 (§10-5)。runtime import なし (typeof import) — façade の入出力が handler の呼び出しと
// wire response 構築を無変更で通ることを typecheck で固定する。壊れたらこのファイルが赤くなる。

type Facade = typeof import("../index");

// guard の Actor はそのまま façade へ渡せる。
const _actorCompat: (actor: Actor) => MfaTotpActor = (actor) => actor;

type EnrollOk = Extract<Awaited<ReturnType<Facade["enroll"]>>, { ok: true }>;
const _enrollWire = (r: EnrollOk): MfaEnrollResponse => ({
  totp_uri: r.totpUri,
  recovery_codes: r.recoveryCodes,
  enrollment_id: r.enrollmentId,
});

type StatusResult = Awaited<ReturnType<Facade["getStatus"]>>;
const _statusWire = (r: StatusResult): MfaStatusResponse => ({
  enabled: r.enabled,
  // in_effect ≡ enabled の恒等写像 (handler と同じ 1 行)。
  in_effect: r.enabled,
  recovery_codes_remaining: r.recoveryCodesRemaining,
});

type ActivateOk = Extract<Awaited<ReturnType<Facade["activate"]>>, { ok: true }>;
type DisableOk = Extract<Awaited<ReturnType<Facade["disable"]>>, { ok: true }>;
const _activateForward = (r: ActivateOk): Headers => r.sessionChanges;
const _disableForward = (r: DisableOk): Headers => r.sessionChanges;
const _okBody: MfaOkResponse = { ok: true };

// 失敗枝は handler が 1 行で HTTP に落とせる形 ({ error, status })。
type ActivateFailure = Extract<Awaited<ReturnType<Facade["activate"]>>, { ok: false }>;
const _failureWire = (r: ActivateFailure): MfaErrorResponse => ({ error: r.error });
const _failureStatus = (r: ActivateFailure): number => r.status;

// チャレンジ 2 依存の入出力互換。
type ChallengeState = Awaited<ReturnType<Facade["readLoginChallengeState"]>>;
const _challengeStateWire = (r: ChallengeState): MfaChallengeStateResponse => r;

type CompletionOk = Extract<
  Awaited<ReturnType<Facade["completeLoginChallengeOperation"]>>,
  { ok: true }
>;
const _completionWire = (r: CompletionOk): MfaChallengeVerifyResponse => ({
  redirect_url: r.redirectUrl,
});
const _completionForward = (r: CompletionOk): Headers => r.forwardedHeaders;

test("契約検出器は typecheck で機能する (runtime 検証なし)", () => {
  expect(true).toBe(true);
});
