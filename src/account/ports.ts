import { Context } from "effect";
import type * as userRepo from "@/db/repositories/user";
import type { LiftedModule } from "../errors";

export class UserRepo extends Context.Service<UserRepo, LiftedModule<typeof userRepo>>()(
  "taimei/UserRepo",
) {}
