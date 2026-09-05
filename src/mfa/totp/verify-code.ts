import { Clock, Effect } from "effect";
import { InvalidCode, NotEnabled } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import { codeCipher, decryptText, decryptValue, secretCipher } from "./cipher";
import { MfaKeyring, MfaTotpRepo } from "./ports";
import { matchTotpCode } from "./totp-engine";

// 検証 kernel (disable / ログインチャレンジ共用)。照合 (副作用なし) と消費 (条件付き単文) を分離する —
// チャレンジ経路は「照合 → チャレンジ消費 → コード消費」の順に並べ、チャレンジ消費で敗北した時に
// 再生成不能なリカバリーコードを焼かない (焼失側は再発行自由なチャレンジに寄せる。ADR-0016)。
// 復号の失敗 (鍵不在・AAD 不一致・改ざん) は cipher の契約どおり defect のまま上げる (Effect.promise)。

export type MatchedOwnedCode =
  | { kind: "totp"; timestep: number }
  | { kind: "recovery_code"; id: string };

// 副作用なしの照合。リカバリーコードは未使用分を順に復号して等値照合 — コードは一様乱数で
// attacker 制御の秘密相関が無く、等値比較 1 回の timing 側路は許容する (ADR-0016)。
export const matchOwnedCode = Effect.fn("mfa.matchOwnedCode")(function* (
  userId: string,
  input: { code: string; kind: MfaCodeKind },
) {
  const mfa = yield* MfaTotpRepo;
  const ring = yield* (yield* MfaKeyring).ring;

  const row = yield* mfa.findMfaTotp(userId);
  if (!row || row.verifiedAt === null) return yield* new NotEnabled();

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

// 消費の決着点。false = リプレイ・過去 timestep・並行敗者 (条件付き単文の WHERE が判定する)。
export const consumeMatchedCode = Effect.fn("mfa.consumeMatchedCode")(function* (
  userId: string,
  matched: MatchedOwnedCode,
) {
  const mfa = yield* MfaTotpRepo;
  return matched.kind === "totp"
    ? yield* mfa.consumeTotpTimestep(userId, matched.timestep)
    : yield* mfa.consumeRecoveryCode(userId, matched.id);
});

// 照合 + 消費の合成 (disable 経路用)。成功 = 本人確認が確定した状態。
export const verifyAndConsumeOwnedCode = Effect.fn("mfa.verifyAndConsumeOwnedCode")(function* (
  userId: string,
  input: { code: string; kind: MfaCodeKind },
) {
  const matched = yield* matchOwnedCode(userId, input);
  if (!(yield* consumeMatchedCode(userId, matched))) return yield* new InvalidCode();
});
