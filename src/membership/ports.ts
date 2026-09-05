import type { Effect } from "effect";
import { Context } from "effect";
import type * as repo from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import type { DbError, Lifted } from "../errors";
import type { LastOwner } from "./errors";

// membership domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項): Repository (db/repositories、Promise) の Effect face。
// use-case と guard はこの service を yield* し、db/repositories を直接 import しない。identity DB を
// 別 process (RPC) へ分離する時はこの interface の live 実装だけを差し替える。
export class MembershipRepo extends Context.Service<
  MembershipRepo,
  {
    findMembership: Lifted<typeof repo.findMembership>;
    findMembershipsByUserId: Lifted<typeof repo.findMembershipsByUserId>;
    findMembersByCompanyId: Lifted<typeof repo.findMembersByCompanyId>;
    countActiveMembershipsByUserId: Lifted<typeof repo.countActiveMembershipsByUserId>;
    findCompaniesBlockingUserDeletion: Lifted<typeof repo.findCompaniesBlockingUserDeletion>;
    insertMembership: Lifted<typeof repo.insertMembership>;
    updateMembershipRole: Lifted<typeof repo.updateMembershipRole>;
    deleteMembership: Lifted<typeof repo.deleteMembership>;
    removeMembershipsOfCompany: Lifted<typeof repo.removeMembershipsOfCompany>;
    findDeletedCompanyIdsWithMemberships: Lifted<typeof repo.findDeletedCompanyIdsWithMemberships>;
    lockUserForCompanyCreation: Lifted<typeof repo.lockUserForCompanyCreation>;
    lockOwnerMembershipsOfCompany: Lifted<typeof repo.lockOwnerMembershipsOfCompany>;
    lockMembershipForShare: Lifted<typeof repo.lockMembershipForShare>;
    // OWNER ≥ 1 不変条件付きの区間。callback の failure / defect は tx ごと rollback (Transaction と同じ意味論)、
    // 不変条件を割ると LastOwner。
    withOwnerLockGuard<A, E, R>(
      tx: DbTx,
      companyId: string,
      f: (tx: DbTx) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | LastOwner | DbError, R>;
  }
>()("taimei/MembershipRepo") {}
