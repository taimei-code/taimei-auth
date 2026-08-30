import {
  findMfaTotp,
  generateEnrollmentId,
  generateRecoveryCodeId,
  insertMfaTotpEnrollment,
  insertRecoveryCodes,
  listUnusedRecoveryCodes,
  type MfaTotpRow,
} from "@/db/repositories/mfa-totp";
import { runInTransaction } from "@/db/transaction";
import { ALREADY_ENABLED, CHALLENGE_EXPIRED, failure } from "../error-mapping";
import type { MfaTotpActor, TotpEnrollResult } from "./contracts";
import { codeCipher, decryptText, decryptValue, encryptValue, secretCipher } from "./cipher";
import type { EnrollMfaDependencies } from "./ports";
import { generateRecoveryCodes } from "./recovery-codes";
import { buildTotpUri, generateTotpSecret } from "./totp-engine";

// 登録開始 (secret 発行)。並行決着は insert の ON CONFLICT が担い、敗者は勝者の内容へ収束する。
// 「登録済み未有効の間は同じ登録内容を再表示できる」契約 (CONTEXT.md) は replay が実装する。

export function createMfaEnrollment(deps: EnrollMfaDependencies) {
  async function replay(actor: MfaTotpActor, row: MfaTotpRow): Promise<TotpEnrollResult> {
    if (row.verifiedAt !== null) return failure(ALREADY_ENABLED);
    const ring = deps.ring();
    const secret = await decryptValue(ring, secretCipher(row), actor.id);
    // 未有効の間は消費経路が無いため全件が未使用のまま残っている (id 昇順 = 発行順)。
    const recoveryCodes = await Promise.all(
      (await listUnusedRecoveryCodes(actor.id)).map((code) =>
        decryptText(ring, codeCipher(code), actor.id),
      ),
    );
    return {
      ok: true,
      enrollmentId: row.enrollmentId,
      totpUri: buildTotpUri({ issuer: deps.issuer(), accountLabel: actor.email, secret }),
      recoveryCodes,
    };
  }

  return async function enroll(input: { actor: MfaTotpActor }): Promise<TotpEnrollResult> {
    const existing = await findMfaTotp(input.actor.id);
    if (existing) return replay(input.actor, existing);

    const ring = deps.ring();
    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes();
    const enrollmentId = generateEnrollmentId();
    const encryptedSecret = await encryptValue(ring, secret, input.actor.id);
    const encoder = new TextEncoder();
    const encryptedCodes = await Promise.all(
      recoveryCodes.map((code) => encryptValue(ring, encoder.encode(code), input.actor.id)),
    );

    const won = await runInTransaction(async (tx) => {
      const inserted = await insertMfaTotpEnrollment(
        {
          userId: input.actor.id,
          enrollmentId,
          secretCiphertext: encryptedSecret.ciphertext,
          secretIv: encryptedSecret.iv,
          keyVersion: encryptedSecret.keyVersion,
        },
        tx,
      );
      if (!inserted) return false;
      await insertRecoveryCodes(
        encryptedCodes.map((code, i) => ({
          id: generateRecoveryCodeId(i),
          userId: input.actor.id,
          codeCiphertext: code.ciphertext,
          codeIv: code.iv,
          keyVersion: code.keyVersion,
        })),
        tx,
      );
      return true;
    });
    if (won) {
      return {
        ok: true,
        enrollmentId,
        totpUri: buildTotpUri({ issuer: deps.issuer(), accountLabel: input.actor.email, secret }),
        recoveryCodes,
      };
    }

    // ON CONFLICT の敗者は再読して勝者の内容へ収束する。読んだ行が消えていた稀な交差
    // (勝者の直後 disable 等) は「もう一度最初から」へ倒す。
    const winner = await findMfaTotp(input.actor.id);
    if (!winner) return failure(CHALLENGE_EXPIRED);
    return replay(input.actor, winner);
  };
}
