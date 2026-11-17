import { Context } from "effect";
import type * as repo from "@/db/repositories/passkey";
import type { LiftedModule } from "../errors";

export class PasskeyRepo extends Context.Service<PasskeyRepo, LiftedModule<typeof repo>>()(
  "taimei/PasskeyRepo",
) {}
