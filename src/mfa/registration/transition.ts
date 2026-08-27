import {
  failure,
  TEMPORARILY_UNAVAILABLE,
  USER_NOT_FOUND,
  type MfaFailure,
} from "../error-mapping";
import type { RegistrationOperationKind, RegistrationSnapshot, TransitionGuard } from "./ports";

// 正常な遷移は better-auth 呼び出し数回の秒オーダーで終わる (acquire 自体は 250ms 上限)。
// これを大きく超えて残る guard は結果不明の残置とみなし観測する。解放はしない (ADR-0013 §8)。
const STALE_GUARD_REPORT_AFTER_MS = 15 * 60 * 1000;

// phase は運用者の復旧手順を分ける判別子: "transition" = 結果不明で guard を意図的に残置
// (解除前に先行 process の停止確認が必須)、"release" = 遷移は確定済みで解放だけ失敗 (解除してよい)、
// "acquire" = 取得できなかった側の観測 (滞留 guard の検知・DB 遅延の busy 化)。
// 区別できないと、待つべき場面で解除して writer を交差させるか、解除してよい場面で待たせ続ける。
export type ReportUnknownTransition = (event: {
  operation: RegistrationOperationKind;
  phase: "acquire" | "transition" | "release";
  error: unknown;
}) => void;

const ignoreUnknownTransition: ReportUnknownTransition = () => undefined;

export function createTransitionRunner(
  guard: TransitionGuard,
  reportUnknown: ReportUnknownTransition = ignoreUnknownTransition,
) {
  return async function runTransition<T>(
    userId: string,
    operation: RegistrationOperationKind,
    work: (snapshot: RegistrationSnapshot) => Promise<T>,
  ): Promise<T | MfaFailure> {
    const acquired = await guard.acquire(userId, operation);
    if (!acquired.acquired) {
      if (acquired.cause === "user_absent") return failure(USER_NOT_FOUND);
      if (acquired.cause === "timeout") {
        reportWithoutChangingOutcome(reportUnknown, {
          operation,
          phase: "acquire",
          error: new Error("MFA registration guard acquire hit statement_timeout (busy に変換)"),
        });
      } else if (
        acquired.cause === "held" &&
        acquired.heldSince !== undefined &&
        Date.now() - acquired.heldSince.getTime() > STALE_GUARD_REPORT_AFTER_MS
      ) {
        reportWithoutChangingOutcome(reportUnknown, {
          operation,
          phase: "acquire",
          error: new Error(
            `MFA registration guard held since ${acquired.heldSince.toISOString()} (stale)`,
          ),
        });
      }
      return failure(TEMPORARILY_UNAVAILABLE);
    }

    let result: T;
    try {
      result = await work(acquired.hold.snapshot);
    } catch (error) {
      reportWithoutChangingOutcome(reportUnknown, { operation, phase: "transition", error });
      throw error;
    }

    try {
      const released = await guard.release(acquired.hold);
      if (!released.released) {
        reportWithoutChangingOutcome(reportUnknown, {
          operation,
          phase: "release",
          error: new Error("MFA registration transition guard release failed"),
        });
      }
    } catch (error) {
      reportWithoutChangingOutcome(reportUnknown, { operation, phase: "release", error });
    }
    return result;
  };
}

function reportWithoutChangingOutcome(
  report: ReportUnknownTransition,
  event: Parameters<ReportUnknownTransition>[0],
): void {
  try {
    report(event);
  } catch {
    // 観測障害で元の操作結果を置き換えない。
  }
}
