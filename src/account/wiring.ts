import { Layer } from "effect";
import * as sessionRepo from "@/db/repositories/session";
import * as userRepo from "@/db/repositories/user";
import { liftAll } from "../errors";
import { SessionRepo, UserRepo } from "./ports";

export const UserRepoLive = Layer.succeed(UserRepo, liftAll(userRepo));

const SessionRepoLive = Layer.succeed(SessionRepo, liftAll(sessionRepo));

export const AccountLayers = Layer.mergeAll(UserRepoLive, SessionRepoLive);
