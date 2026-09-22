import { Effect, Layer } from "effect";
import * as repo from "@/db/repositories/mfa-totp";
import { getAppName } from "../../email/client";
import { liftAll } from "../../errors";
import { resetDisableAttempts, spendDisableAttempt } from "../disable-attempt-budget";
import { issueSessionFor, revokeOtherSessions } from "../gateway";
import { notifyMfaDisabled, notifyMfaEnabled } from "../notification-adapter";
import { type MfaKeyRing, parseMfaKeyRing } from "./cipher";
import {
  MfaDisableBudget,
  MfaIssuer,
  MfaKeyring,
  MfaNotifier,
  MfaSessions,
  MfaTotpRepo,
} from "./ports";

const MfaTotpRepoLive = Layer.succeed(MfaTotpRepo, liftAll(repo));

let cached: MfaKeyRing | undefined;

const MfaKeyringLive = Layer.succeed(
  MfaKeyring,
  MfaKeyring.of({
    ring: Effect.sync(() => (cached ??= parseMfaKeyRing(process.env.MFA_TOTP_ENCRYPTION_KEYS))),
  }),
);

const MfaIssuerLive = Layer.succeed(MfaIssuer, MfaIssuer.of({ appName: Effect.sync(getAppName) }));

const MfaSessionsLive: Layer.Layer<MfaSessions> = Layer.succeed(
  MfaSessions,
  MfaSessions.of({ revokeOthers: revokeOtherSessions, issueSession: issueSessionFor }),
);

const MfaNotifierLive = Layer.succeed(
  MfaNotifier,
  MfaNotifier.of({
    notifyEnabled: notifyMfaEnabled,
    notifyDisabled: notifyMfaDisabled,
  }),
);

const MfaDisableBudgetLive = Layer.succeed(
  MfaDisableBudget,
  MfaDisableBudget.of({ spend: spendDisableAttempt, reset: resetDisableAttempts }),
);

export const MfaLayers = Layer.mergeAll(
  MfaTotpRepoLive,
  MfaKeyringLive,
  MfaIssuerLive,
  MfaSessionsLive,
  MfaNotifierLive,
  MfaDisableBudgetLive,
);
