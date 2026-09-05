import { type Effect, Layer } from "effect";
import * as repo from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { DbError, liftAll } from "../errors";
import { runThroughCallback } from "../transaction";
import { LastOwner } from "./errors";
import { MembershipRepo } from "./ports";

// production 結線。repository 関数を module ロード時に bind してよい理由は db/CLAUDE.md の workerd gotcha
// (RoutingPool が ALS から per-request pool を引くため、関数自体は request 横断で共有できる / PR #91)。
// per-request でしか持てないリソース (pg.Pool 実体等) はここに bind しない。
export const MembershipRepoLive = Layer.succeed(
  MembershipRepo,
  MembershipRepo.of({
    ...liftAll(repo),
    withOwnerLockGuard: <A, E, R>(
      tx: DbTx,
      companyId: string,
      f: (tx: DbTx) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | LastOwner | DbError, R> =>
      runThroughCallback<A, E, R, LastOwner | DbError>(
        (run) => repo.withOwnerLockGuard(tx, companyId, (t) => run(f(t))),
        (cause) =>
          cause instanceof repo.OwnerInvariantViolation ? new LastOwner() : new DbError({ cause }),
      ),
  }),
);
