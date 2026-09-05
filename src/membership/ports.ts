import type { Effect } from "effect";
import { Context } from "effect";
import type * as repo from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import type { DbError, LiftedModule } from "../errors";
import type { LastOwner } from "./errors";

// membership domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項): Repository (db/repositories、Promise) の Effect face。
// use-case と guard はこの service を yield* し、db/repositories を直接 import しない。identity DB を
// 別 process (RPC) へ分離する時はこの interface の live 実装だけを差し替える。
// 型導出の規則は src/CLAUDE.md の Effect様式。callback API の withOwnerLockGuard だけ Effect 版で上書きする。
export class MembershipRepo extends Context.Service<
  MembershipRepo,
  Omit<LiftedModule<typeof repo>, "withOwnerLockGuard"> & {
    // OWNER ≥ 1 不変条件付きの区間。callback の failure / defect は tx ごと rollback (Transaction と同じ意味論)、
    // 不変条件を割ると LastOwner。
    withOwnerLockGuard<A, E, R>(
      tx: DbTx,
      companyId: string,
      f: (tx: DbTx) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | LastOwner | DbError, R>;
  }
>()("taimei/MembershipRepo") {}
