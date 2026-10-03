import { Layer } from "effect";
import * as userRepo from "@/db/repositories/user";
import { liftAll } from "../errors";
import { UserRepo } from "./ports";

export const UserRepoLive = Layer.succeed(UserRepo, liftAll(userRepo));
