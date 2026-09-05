import { Context } from "effect";
import type * as accountRepo from "@/db/repositories/account";
import type * as sessionRepo from "@/db/repositories/session";
import type * as userRepo from "@/db/repositories/user";
import type { Lifted } from "../errors";

// account domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項)。user 行の読み書き、session 失効、連携 account の読み取り。
export class UserRepo extends Context.Service<
  UserRepo,
  {
    findById: Lifted<typeof userRepo.findUserById>;
    findByEmail: Lifted<typeof userRepo.findUserByEmail>;
    update: Lifted<typeof userRepo.updateUser>;
    deleteUser: Lifted<typeof userRepo.deleteUser>;
    updateLastUsedCompany: Lifted<typeof userRepo.updateUserLastUsedCompany>;
    findAbandonedSignupUserIds: Lifted<typeof userRepo.findAbandonedSignupUserIds>;
    reassignLastUsedCompanyForDeletedCompany: Lifted<
      typeof userRepo.reassignLastUsedCompanyForDeletedCompany
    >;
  }
>()("taimei/UserRepo") {}

export class SessionRepo extends Context.Service<
  SessionRepo,
  {
    findSessionRevokedAt: Lifted<typeof sessionRepo.findSessionRevokedAt>;
    // revoked_at 記帳だけでは Redis の session 実体が失効しない。呼び出しは src/account/revoke-sessions.ts に閉じる。
    revokeAllSessionsForUser: Lifted<typeof sessionRepo.revokeAllSessionsForUser>;
  }
>()("taimei/SessionRepo") {}

export class AccountRepo extends Context.Service<
  AccountRepo,
  {
    findByUserId: Lifted<typeof accountRepo.findAccountByUserId>;
  }
>()("taimei/AccountRepo") {}
