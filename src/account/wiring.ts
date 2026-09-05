import { Layer } from "effect";
import * as accountRepo from "@/db/repositories/account";
// revokeAllSessionsForUser の use-case 側の窓口は src/account/revoke-sessions.ts (biome の importNames 制限は
// named import に効く)。ports の live wiring はその窓口に service を供給する結線点。
import * as sessionRepo from "@/db/repositories/session";
import * as userRepo from "@/db/repositories/user";
import { liftAll } from "../errors";
import { AccountRepo, SessionRepo, UserRepo } from "./ports";

// production 結線 (module ロード時 bind の根拠は src/membership/wiring.ts と同じ: db/CLAUDE.md の workerd gotcha)。
export const UserRepoLive = Layer.succeed(UserRepo, liftAll(userRepo));

export const SessionRepoLive = Layer.succeed(SessionRepo, liftAll(sessionRepo));

export const AccountRepoLive = Layer.succeed(AccountRepo, liftAll(accountRepo));

export const AccountLayers = Layer.mergeAll(UserRepoLive, SessionRepoLive, AccountRepoLive);
