import { Effect } from "effect";
import { enabled } from "../feature-flags";
import { PasskeyRegistrationUnavailable } from "./errors";

declare module "../feature-flags" {
  interface FeatureFlagRegistry {
    readonly passkey: "everyone";
  }
}

export const passkeyReleased = () => enabled("passkey");

export const requireRegistrationOpen = Effect.fnUntraced(function* () {
  if (!(yield* passkeyReleased())) return yield* new PasskeyRegistrationUnavailable();
});
