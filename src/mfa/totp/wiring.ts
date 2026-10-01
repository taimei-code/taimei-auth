import { Effect, Layer } from "effect";
import * as repo from "@/db/repositories/mfa-totp";
import { liftAll } from "../../errors";
import { type MfaKeyRing, parseMfaKeyRing } from "./cipher";
import { MfaKeyring, MfaTotpRepo } from "./ports";

const MfaTotpRepoLive = Layer.succeed(MfaTotpRepo, liftAll(repo));

let cached: MfaKeyRing | undefined;

const MfaKeyringLive = Layer.succeed(
  MfaKeyring,
  MfaKeyring.of({
    ring: Effect.sync(() => (cached ??= parseMfaKeyRing(process.env.MFA_TOTP_ENCRYPTION_KEYS))),
  }),
);

export const MfaLayers = Layer.mergeAll(MfaTotpRepoLive, MfaKeyringLive);
