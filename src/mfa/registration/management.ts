import { failure, USER_NOT_FOUND, type MfaFailure } from "../error-mapping";
import type { ForceDisableResult } from "./force-disable";
import type { GuardedGatewayFactory, RegistrationSnapshot, TransitionGuard } from "./ports";
import { createTransitionRunner, type ReportUnknownTransition } from "./transition";

export const MFA_REGISTRATION_GUARD_PROTOCOL_VERSION = 1;

export function assertRegistrationGuardProtocolVersion(version: number | undefined): void {
  if (version === MFA_REGISTRATION_GUARD_PROTOCOL_VERSION) return;
  throw new Error(
    `MFA registration guard protocol mismatch: expected ${MFA_REGISTRATION_GUARD_PROTOCOL_VERSION}, got ${version ?? "missing"}`,
  );
}

type ManagementForceDisableResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; notified: boolean }
  | MfaFailure;

type ReleaseByManagementInput = {
  userId: string;
  source: string;
  reason: string;
  processStoppedConfirmed: boolean;
};

type ManagementReleaseResult =
  | { ok: true; released: boolean }
  | { ok: false; reason: "invalid_release_confirmation" };

export function createManagementApplication(deps: {
  guard: TransitionGuard;
  reportUnknownTransition: ReportUnknownTransition;
  // force-disable は遷移内窓口を使わない (clearTwoFactorEnabled 直 import は既知の例外)。それでも
  // 必須で受けるのは、runner の契約を self-service と一枚にし optional 化の無音穴を作らないため。
  guardedGateway: GuardedGatewayFactory;
  readProtocolVersion(): Promise<number | undefined>;
  findUserById(userId: string): Promise<{ id: string } | undefined>;
  forceDisableOperation(
    userId: string,
    snapshot: RegistrationSnapshot,
  ): Promise<ForceDisableResult>;
  releaseGuardByManagement(input: {
    userId: string;
    source: string;
    reason: string;
    processStoppedConfirmed: true;
  }): Promise<{ released: boolean }>;
  notifyDisabled(email: string): Promise<boolean>;
}): {
  forceDisable(userId: string): Promise<ManagementForceDisableResult>;
  forceReleaseRegistrationGuard(input: ReleaseByManagementInput): Promise<ManagementReleaseResult>;
} {
  const assertGuardProtocol = async (): Promise<void> => {
    assertRegistrationGuardProtocolVersion(await deps.readProtocolVersion());
  };
  const runTransition = createTransitionRunner(
    deps.guard,
    deps.reportUnknownTransition,
    deps.guardedGateway,
  );

  return {
    async forceDisable(userId) {
      await assertGuardProtocol();
      // guard 取得前の存在確認は user 削除との競合による FK 違反を busy に化けさせないための
      // advisory。正式な判定は guard 取得後の snapshot が行う。
      if (!(await deps.findUserById(userId))) return failure(USER_NOT_FOUND);

      const transitioned = await runTransition(userId, "force_disable", (hold) =>
        deps.forceDisableOperation(userId, hold.snapshot),
      );
      if (!transitioned.ok || !transitioned.changed) return transitioned;

      // 通知の失敗で解除を失敗にしない — 解除は確定済みで、再実行しても changed:false になる。
      // 送信可否は notified で報告し、届かなかった場合は運用者が別経路で本人に知らせる。
      // adapter の内部握り潰しに依存せず reject もここで notified:false に畳む — 確定済みの
      // 解除が「失敗」に見えると、運用者に不要な次の手 (DB 直接操作等) を踏ませる。
      let notified = false;
      try {
        notified = await deps.notifyDisabled(transitioned.notifyEmail);
      } catch {
        // 規律の所有はこの façade。dep の実装差で確定結果を変えない。
      }
      return { ok: true, changed: true, notified };
    },
    async forceReleaseRegistrationGuard(input) {
      const source = input.source.trim();
      const reason = input.reason.trim();
      if (!input.processStoppedConfirmed || source.length === 0 || reason.length === 0) {
        return { ok: false, reason: "invalid_release_confirmation" };
      }

      await assertGuardProtocol();
      const result = await deps.releaseGuardByManagement({
        userId: input.userId,
        source,
        reason,
        // literal を書かず narrowing 済みの入力を渡す — repo 側の literal true 型が要求する
        // 「検証を経ない呼び出し元は確認済み audit を書けない」結合を保つ。
        processStoppedConfirmed: input.processStoppedConfirmed,
      });
      return { ok: true, released: result.released };
    },
  };
}
