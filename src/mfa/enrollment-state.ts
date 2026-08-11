import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import type { Actor } from "../membership/guard/core";
import {
  ALREADY_ENABLED,
  CHALLENGE_EXPIRED,
  failure,
  type MfaFailure,
  NOT_ENABLED,
  USER_NOT_FOUND,
} from "./error-mapping";
import { requiresMfaChallenge } from "./policy";

// ADR-0012 (Use-case 層): 「MFA 登録状態」(CONTEXT.md) の解釈と、操作単位の前提条件の 1 発回答。
// 5 状態の定義・各操作の評決・union を export しない理由・並行時の一時観測の正本は
// docs/adr/0013-mfa-totp-challenge.md §7 の 5 状態マトリクス (評決を変える変更は表の更新とセット)。
//
// この判定は kill-switch (MFA_CHALLENGE_ENABLED) を見ない — 消費はログイン境界
// (src/auth-plugins/mfa-challenge.ts) のみ。混ぜたときの事故は ADR-0013 §7「運用上の境界」。
//
// フラグは requiresMfaChallenge 経由で読む (規律: policy.ts)。

type EnrollmentRecord = "absent" | "unverified";

type MfaEnrollmentState =
  | { kind: "none" }
  | { kind: "enrolled_pending" }
  | { kind: "active" }
  | { kind: "interrupted_disable" }
  | { kind: "interrupted_activate"; enrollmentRecord: EnrollmentRecord };

// 「フラグ × 行」の 2 事実から 5 状態への純粋写像 (I/O なし)。前提条件 entry はどの状態でも
// 行が要る — flag=false 側の 3 状態 (未登録 / 登録済み未有効 / 中断した無効化) は行でしか
// 判別できない。flag から省けるのは「中断した有効化」の検出だけ (flag=false なら空振りが確定 —
// read-status がその短絡を呼び出し側で行う)。
function classifyEnrollment(
  challengeRequired: boolean,
  record: { verified: boolean } | undefined,
): MfaEnrollmentState {
  if (challengeRequired) {
    if (record?.verified) return { kind: "active" };
    // 不変条件「twoFactorEnabled: true ⇒ verified 行が存在」(SSOT: db/schema.ts の twoFactor
    // テーブル定義コメント) の破れ。行の有無は復旧経路の診断材料として観測側へ渡す。
    return { kind: "interrupted_activate", enrollmentRecord: record ? "unverified" : "absent" };
  }
  if (!record) return { kind: "none" };
  return record.verified ? { kind: "interrupted_disable" } : { kind: "enrolled_pending" };
}

async function readState(actor: Actor): Promise<MfaEnrollmentState> {
  const challengeRequired = requiresMfaChallenge(actor);
  return classifyEnrollment(challengeRequired, await findTwoFactorVerificationState(actor.id));
}

// enroll の拒否と disable の受理は同一述語の裏表 — フラグと verified 行のどちらかが有効を
// 主張していれば「今 MFA が効いている」。
function isMfaInEffect(state: MfaEnrollmentState): boolean {
  switch (state.kind) {
    case "active":
    case "interrupted_disable":
    case "interrupted_activate":
      return true;
    case "none":
    case "enrolled_pending":
      return false;
  }
}

export async function ensureCanEnroll(actor: Actor): Promise<MfaFailure | undefined> {
  return isMfaInEffect(await readState(actor)) ? failure(ALREADY_ENABLED) : undefined;
}

export async function ensureCanActivate(actor: Actor): Promise<MfaFailure | undefined> {
  const state = await readState(actor);
  if (isMfaInEffect(state)) return failure(ALREADY_ENABLED);
  if (state.kind === "none") return failure(USER_NOT_FOUND);
  return undefined;
}

// disable の前提条件 (コード検証・試行枠消費より前に置く)。中断 2 状態の受理はそれぞれ唯一の
// 出口 / 唯一の自己復旧口なので状態判定で先に弾かない。ただし「中断した有効化 × 行なし」だけは
// 検証すべき secret が無く正しいコードでも永久に成功しないため、ここで challenge_expired に落とす
// — そうしないと試行枠を空費し、正しいコードでも 5 回で 429 ロックに達する (救済は運用スクリプト)。
// 評決の正本: ADR-0013 §7。
export async function ensureDisableCanProceed(actor: Actor): Promise<MfaFailure | undefined> {
  const state = await readState(actor);
  if (!isMfaInEffect(state)) return failure(NOT_ENABLED);
  if (state.kind === "interrupted_activate" && state.enrollmentRecord === "absent") {
    return failure(CHALLENGE_EXPIRED);
  }
  return undefined;
}

// read-status が 1 回の readState から要る事実をまとめて返す。inEffect は SPA が disable / enroll の
// どちらを出すかの判定に使う (「中断した無効化」は enabled=false だが inEffect=true — enroll は 409
// なので disable を出さないと UI の袋小路になる)。interrupted は通報と残数取得スキップに使う
// (通報の要否・throttle は呼び出し側が持つ)。
export async function readEnrollmentFacts(actor: Actor): Promise<{
  inEffect: boolean;
  interrupted?: { enrollmentRecord: EnrollmentRecord };
}> {
  const state = await readState(actor);
  return {
    inEffect: isMfaInEffect(state),
    interrupted:
      state.kind === "interrupted_activate"
        ? { enrollmentRecord: state.enrollmentRecord }
        : undefined,
  };
}
