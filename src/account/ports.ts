import { Context } from "effect";
import type * as sessionRepo from "@/db/repositories/session";
import type * as userRepo from "@/db/repositories/user";
import type { LiftedModule } from "../errors";

export class UserRepo extends Context.Service<UserRepo, LiftedModule<typeof userRepo>>()(
  "taimei/UserRepo",
) {}

export class SessionRepo extends Context.Service<SessionRepo, LiftedModule<typeof sessionRepo>>()(
  "taimei/SessionRepo",
) {}
