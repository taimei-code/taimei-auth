import {
  consumeRecoveryCode,
  consumeTotpTimestep,
  findMfaTotp,
  listUnusedRecoveryCodes,
} from "@/db/repositories/mfa-totp";
import { failure, INVALID_CODE, NOT_ENABLED, type MfaFailure } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import { codeCipher, decryptText, decryptValue, secretCipher, type MfaKeyRing } from "./cipher";
import { matchTotpCode } from "./totp-engine";

// 検証 kernel (disable / ログインチャレンジ共用)。照合 (副作用なし) と消費 (条件付き単文) を分離する —
// チャレンジ経路は「照合 → チャレンジ消費 → コード消費」の順に並べ、チャレンジ消費で敗北した時に
// 再生成不能なリカバリーコードを焼かない (焼失側は再発行自由なチャレンジに寄せる。ADR-0016)。

export type MatchedOwnedCode =
  | { kind: "totp"; timestep: number }
  | { kind: "recovery_code"; id: string };

export type MatchOwnedCodeResult = { ok: true; matched: MatchedOwnedCode } | MfaFailure;

// 副作用なしの照合。リカバリーコードは未使用分を順に復号して等値照合 — コードは一様乱数で
// attacker 制御の秘密相関が無く、等値比較 1 回の timing 側路は許容する (ADR-0016)。
export async function matchOwnedCode(
  ring: MfaKeyRing,
  userId: string,
  input: { code: string; kind: MfaCodeKind },
): Promise<MatchOwnedCodeResult> {
  const row = await findMfaTotp(userId);
  if (!row || row.verifiedAt === null) return failure(NOT_ENABLED);

  if (input.kind === "totp") {
    const secret = await decryptValue(ring, secretCipher(row), userId);
    const timestep = matchTotpCode(secret, input.code);
    return timestep === null
      ? failure(INVALID_CODE)
      : { ok: true, matched: { kind: "totp", timestep } };
  }

  for (const candidate of await listUnusedRecoveryCodes(userId)) {
    const plain = await decryptText(ring, codeCipher(candidate), userId);
    if (plain !== input.code) continue;
    return { ok: true, matched: { kind: "recovery_code", id: candidate.id } };
  }
  return failure(INVALID_CODE);
}

// 消費の決着点。false = リプレイ・過去 timestep・並行敗者 (条件付き単文の WHERE が判定する)。
export async function consumeMatchedCode(
  userId: string,
  matched: MatchedOwnedCode,
): Promise<boolean> {
  return matched.kind === "totp"
    ? consumeTotpTimestep(userId, matched.timestep)
    : consumeRecoveryCode(userId, matched.id);
}

// 照合 + 消費の合成 (disable 経路用)。undefined = 成功。
export async function verifyAndConsumeOwnedCode(
  ring: MfaKeyRing,
  userId: string,
  input: { code: string; kind: MfaCodeKind },
): Promise<MfaFailure | undefined> {
  const result = await matchOwnedCode(ring, userId, input);
  if (!result.ok) return result;
  return (await consumeMatchedCode(userId, result.matched)) ? undefined : failure(INVALID_CODE);
}
