import { Effect } from "effect";
import { appendAuditLogBestEffort } from "../../audit/report-failure";
import { getClientContext } from "../../request-context";
import { Transaction } from "../../transaction";
import { NotEnabled } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import type { MfaTotpActor, TotpSessionChanges } from "./contracts";
import { MfaDisableBudget, MfaNotifier, MfaSessions, MfaTotpRepo } from "./ports";
import { verifyAndConsumeOwnedCode } from "./verify-code";

// 無効化 (正しいコードによる本人確認つき)。1 tx で行 + コード全削除 — 途中で死んでも 3 状態の
// いずれかに留まり再実行で収束する。試行 budget は総当たり防御 (disable-attempt-budget)。
export const disable = Effect.fn("mfa.disable")(function* (input: {
  actor: MfaTotpActor;
  headers: Headers;
  code: string;
  kind: MfaCodeKind;
}) {
  const mfa = yield* MfaTotpRepo;
  // 未登録に budget を消費させない前段判定は最小射影で足りる (secret 込みの行は kernel が読む)。
  const enrollment = yield* mfa.readMfaVerification(input.actor.id);
  if (!enrollment || enrollment.verifiedAt === null) return yield* new NotEnabled();

  const budget = yield* MfaDisableBudget;
  yield* budget.spend(input.actor.id);

  yield* verifyAndConsumeOwnedCode(input.actor.id, { code: input.code, kind: input.kind });
  yield* budget.reset(input.actor.id);

  const sessions = yield* MfaSessions;
  const sessionChanges = yield* sessions.revokeOthers(input.headers);

  const tx = yield* Transaction;
  yield* tx.run((t) =>
    Effect.gen(function* () {
      yield* mfa.deleteMfaTotp(input.actor.id, t);
      yield* mfa.deleteRecoveryCodesByUserId(input.actor.id, t);
    }),
  );

  // best-effort 記帳 (CONTEXT.md)。
  const { ip, userAgent } = getClientContext(input.headers);
  yield* appendAuditLogBestEffort({
    eventType: "mfa_disabled",
    userId: input.actor.id,
    payload: { ip, userAgent },
  });
  yield* (yield* MfaNotifier).notifyDisabled(input.actor.email);
  return { sessionChanges } satisfies TotpSessionChanges;
});
