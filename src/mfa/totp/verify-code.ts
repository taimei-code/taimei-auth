import { Clock, Effect } from "effect";
import { InvalidCode, NotEnabled } from "../error-mapping";
import { isMfaEnabled } from "../policy";
import type { MfaCodeKind } from "../wire-contracts";
import { codeCipher, decryptText, decryptValue, secretCipher } from "./cipher";
import { MfaKeyring, MfaTotpRepo } from "./ports";
import { matchTotpCode } from "./totp-engine";

export type MatchedOwnedCode =
  | { kind: "totp"; timestep: number }
  | { kind: "recovery_code"; id: string };

// リカバリーコードは一様乱数で attacker 制御の秘密相関が無く、等値比較の timing 側路は許容する。
export const matchOwnedCode = Effect.fn("mfa.matchOwnedCode")(function* (
  userId: string,
  input: { code: string; kind: MfaCodeKind },
) {
  const mfa = yield* MfaTotpRepo;
  const ring = yield* MfaKeyring.use((k) => k.ring);

  const row = yield* mfa.findMfaTotp(userId);
  if (!isMfaEnabled(row)) return yield* new NotEnabled();

  if (input.kind === "totp") {
    const secret = yield* Effect.promise(() => decryptValue(ring, secretCipher(row), userId));
    const timestep = matchTotpCode(secret, input.code, yield* Clock.currentTimeMillis);
    if (timestep === null) return yield* new InvalidCode();
    return { kind: "totp", timestep } satisfies MatchedOwnedCode;
  }

  for (const candidate of yield* mfa.listUnusedRecoveryCodes(userId)) {
    const plain = yield* Effect.promise(() => decryptText(ring, codeCipher(candidate), userId));
    if (plain !== input.code) continue;
    return { kind: "recovery_code", id: candidate.id } satisfies MatchedOwnedCode;
  }
  return yield* new InvalidCode();
});

// リプレイ・過去 timestep・並行敗者は条件付き単文の WHERE が弾く。
export const consumeMatchedCode = Effect.fn("mfa.consumeMatchedCode")(function* (
  userId: string,
  matched: MatchedOwnedCode,
) {
  const consumed = yield* MfaTotpRepo.use((mfa) =>
    matched.kind === "totp"
      ? mfa.consumeTotpTimestep(userId, matched.timestep)
      : mfa.consumeRecoveryCode(userId, matched.id),
  );
  if (!consumed) return yield* new InvalidCode();
});

export const verifyAndConsumeOwnedCode = Effect.fn("mfa.verifyAndConsumeOwnedCode")(function* (
  userId: string,
  input: { code: string; kind: MfaCodeKind },
) {
  yield* consumeMatchedCode(userId, yield* matchOwnedCode(userId, input));
});
