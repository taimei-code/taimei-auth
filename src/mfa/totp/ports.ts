import type { Effect } from "effect";
import { Context } from "effect";
import type * as repo from "@/db/repositories/mfa-totp";
import type { LiftedModule } from "../../errors";
import type { MfaKeyRing } from "./cipher";

export class MfaTotpRepo extends Context.Service<MfaTotpRepo, LiftedModule<typeof repo>>()(
  "taimei/MfaTotpRepo",
) {}

// ring を Effect にして import 時に throw させない。
export class MfaKeyring extends Context.Service<
  MfaKeyring,
  { readonly ring: Effect.Effect<MfaKeyRing> }
>()("taimei/MfaKeyring") {}
