import { Effect, Layer } from "effect";
import * as repo from "@/db/repositories/mfa-totp";
import { liftAll } from "../../errors";
import { issueSessionFor, revokeOtherSessions } from "../gateway";
import { type MfaKeyRing, parseMfaKeyRing } from "./cipher";
import { MfaKeyring, MfaSessions, MfaTotpRepo } from "./ports";

const MfaTotpRepoLive = Layer.succeed(MfaTotpRepo, liftAll(repo));

let cached: MfaKeyRing | undefined;

const MfaKeyringLive = Layer.succeed(
  MfaKeyring,
  MfaKeyring.of({
    ring: Effect.sync(() => (cached ??= parseMfaKeyRing(process.env.MFA_TOTP_ENCRYPTION_KEYS))),
  }),
);

const MfaSessionsLive: Layer.Layer<MfaSessions> = Layer.succeed(
  MfaSessions,
  MfaSessions.of({ revokeOthers: revokeOtherSessions, issueSession: issueSessionFor }),
);

export const MfaLayers = Layer.mergeAll(MfaTotpRepoLive, MfaKeyringLive, MfaSessionsLive);
