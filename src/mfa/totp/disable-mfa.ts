import { Effect } from "effect";
import { appendAuditLogBestEffort } from "../../audit/report-failure";
import { getClientContext } from "../../request-context";
import { Transaction } from "../../transaction";
import { NotEnabled } from "../error-mapping";
import { isMfaEnabled } from "../policy";
import type { MfaCodeKind } from "../wire-contracts";
import type { MfaTotpActor, TotpSessionChanges } from "./contracts";
import { MfaDisableBudget, MfaNotifier, MfaSessions, MfaTotpRepo } from "./ports";
import { verifyAndConsumeOwnedCode } from "./verify-code";

// 行とコードの削除を 1 tx にするのは、途中で死んでも再実行で収束させるため。
export const disable = Effect.fn("mfa.disable")(function* (input: {
  actor: MfaTotpActor;
  headers: Headers;
  code: string;
  kind: MfaCodeKind;
}) {
  const mfa = yield* MfaTotpRepo;
  // 有効でない user に budget を消費させないための前段判定。
  const enrollment = yield* mfa.readMfaVerification(input.actor.id);
  if (!isMfaEnabled(enrollment)) return yield* new NotEnabled();

  const budget = yield* MfaDisableBudget;
  yield* budget.spend(input.actor.id);

  yield* verifyAndConsumeOwnedCode(input.actor.id, { code: input.code, kind: input.kind });
  yield* budget.reset(input.actor.id);

  const sessions = yield* MfaSessions;
  const sessionChanges = yield* sessions.revokeOthers(input.headers);

  const tx = yield* Transaction;
  yield* tx.run(
    Effect.fn("mfa.disable.apply")(function* (t) {
      yield* mfa.deleteMfaTotp(input.actor.id, t);
      yield* mfa.deleteRecoveryCodesByUserId(input.actor.id, t);
    }),
  );

  const { ip, userAgent } = getClientContext(input.headers);
  yield* appendAuditLogBestEffort({
    eventType: "mfa_disabled",
    userId: input.actor.id,
    payload: { ip, userAgent },
  });
  yield* MfaNotifier.use((n) => n.notifyDisabled(input.actor.email));
  return { sessionChanges } satisfies TotpSessionChanges;
});
