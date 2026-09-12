import { Effect } from "effect";
import type { MfaTotpRow } from "@/db/repositories/mfa-totp";
import { IdGenerator } from "../../id-generator";
import { Transaction } from "../../transaction";
import { AlreadyEnabled, ChallengeExpired } from "../error-mapping";
import { isMfaEnabled } from "../policy";
import type { MfaTotpActor, TotpEnrollmentMaterial } from "./contracts";
import { codeCipher, decryptText, decryptValue, encryptValue, secretCipher } from "./cipher";
import { MfaIssuer, MfaKeyring, MfaTotpRepo } from "./ports";
import { generateRecoveryCodes } from "./recovery-codes";
import { buildTotpUri, generateTotpSecret } from "./totp-engine";

const replayPendingEnrollment = Effect.fn("mfa.enroll.replay")(function* (
  actor: MfaTotpActor,
  row: MfaTotpRow,
) {
  if (isMfaEnabled(row)) return yield* new AlreadyEnabled();

  const ring = yield* MfaKeyring.use((k) => k.ring);
  const issuer = yield* MfaIssuer.use((i) => i.appName);

  const secret = yield* Effect.promise(() => decryptValue(ring, secretCipher(row), actor.id));
  // 未有効の間は消費経路が無いため全件が未使用のまま残っている。
  const stored = yield* MfaTotpRepo.use((mfa) => mfa.listUnusedRecoveryCodes(actor.id));
  const recoveryCodes = yield* Effect.all(
    stored.map((code) => Effect.promise(() => decryptText(ring, codeCipher(code), actor.id))),
    { concurrency: "unbounded" },
  );

  return {
    enrollmentId: row.enrollmentId,
    totpUri: buildTotpUri({ issuer, accountLabel: actor.email, secret }),
    recoveryCodes,
  } satisfies TotpEnrollmentMaterial;
});

export const enroll = Effect.fn("mfa.enroll")(function* (input: { actor: MfaTotpActor }) {
  const mfa = yield* MfaTotpRepo;
  const existing = yield* mfa.findMfaTotp(input.actor.id);
  if (existing) return yield* replayPendingEnrollment(input.actor, existing);

  const ring = yield* MfaKeyring.use((k) => k.ring);
  const issuer = yield* MfaIssuer.use((i) => i.appName);
  const ids = yield* IdGenerator;
  const tx = yield* Transaction;

  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const enrollmentId = ids.enrollmentId();
  const encryptedSecret = yield* Effect.promise(() => encryptValue(ring, secret, input.actor.id));
  const encoder = new TextEncoder();
  const encryptedCodes = yield* Effect.all(
    recoveryCodes.map((code) =>
      Effect.promise(() => encryptValue(ring, encoder.encode(code), input.actor.id)),
    ),
    { concurrency: "unbounded" },
  );

  const won = yield* tx.run(
    Effect.fn("mfa.enroll.apply")(function* (t) {
      const inserted = yield* mfa.insertMfaTotpEnrollment(
        {
          userId: input.actor.id,
          enrollmentId,
          secretCiphertext: encryptedSecret.ciphertext,
          secretIv: encryptedSecret.iv,
          keyVersion: encryptedSecret.keyVersion,
        },
        t,
      );
      if (!inserted) return false;
      yield* mfa.insertRecoveryCodes(
        encryptedCodes.map((code, i) => ({
          id: ids.recoveryCodeId(i),
          userId: input.actor.id,
          codeCiphertext: code.ciphertext,
          codeIv: code.iv,
          keyVersion: code.keyVersion,
        })),
        t,
      );
      return true;
    }),
  );
  if (won) {
    return {
      enrollmentId,
      totpUri: buildTotpUri({ issuer, accountLabel: input.actor.email, secret }),
      recoveryCodes,
    } satisfies TotpEnrollmentMaterial;
  }

  // 敗者は再読して勝者の内容へ収束する。行が消えていた交差は「もう一度最初から」へ倒す。
  const winner = yield* mfa.findMfaTotp(input.actor.id);
  if (!winner) return yield* new ChallengeExpired();
  return yield* replayPendingEnrollment(input.actor, winner);
});
