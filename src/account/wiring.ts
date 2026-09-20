import { Layer } from "effect";
import * as accountRepo from "@/db/repositories/account";
import * as sessionRepo from "@/db/repositories/session";
import * as userRepo from "@/db/repositories/user";
import { liftAll } from "../errors";
import { AccountRepo, SessionRepo, UserRepo } from "./ports";

export const UserRepoLive = Layer.succeed(UserRepo, liftAll(userRepo));

const SessionRepoLive = Layer.succeed(SessionRepo, liftAll(sessionRepo));

const AccountRepoLive = Layer.succeed(AccountRepo, liftAll(accountRepo));

export const AccountLayers = Layer.mergeAll(UserRepoLive, SessionRepoLive, AccountRepoLive);
