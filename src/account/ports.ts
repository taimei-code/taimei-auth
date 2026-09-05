import { Context } from "effect";
import type * as accountRepo from "@/db/repositories/account";
import type * as sessionRepo from "@/db/repositories/session";
import type * as userRepo from "@/db/repositories/user";
import type { LiftedModule } from "../errors";

// account domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項。型導出の規則は src/CLAUDE.md の Effect様式)。
export class UserRepo extends Context.Service<UserRepo, LiftedModule<typeof userRepo>>()(
  "taimei/UserRepo",
) {}

// revoked_at 記帳だけでは Redis の session 実体が失効しない。revokeAllSessionsForUser の呼び出しは
// src/account/revoke-sessions.ts に閉じる (gate: src/__tests__/effect-boundary.test.ts)。
export class SessionRepo extends Context.Service<SessionRepo, LiftedModule<typeof sessionRepo>>()(
  "taimei/SessionRepo",
) {}

export class AccountRepo extends Context.Service<AccountRepo, LiftedModule<typeof accountRepo>>()(
  "taimei/AccountRepo",
) {}
