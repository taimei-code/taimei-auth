import type { ConnectRouter } from "@connectrpc/connect";
import { Code } from "@connectrpc/connect";
import { Effect } from "effect";
import { deleteAccount } from "../account/delete-account";
import { UserRepo } from "../account/ports";
import { UserService } from "../gen/auth/v1/auth_pb";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { toProtoUser, userResponse } from "./mappers";
import { RpcError, runRpc } from "./run-rpc";

// 各 method は Effect program を runRpc (Connect 側の唯一の写像点) で走らせる (ADR-0017)。
export function registerUserService(router: ConnectRouter) {
  router.service(UserService, {
    findUserByEmail: (req) =>
      runRpc(
        UserRepo.use((users) => users.findUserByEmail(req.email)).pipe(Effect.map(userResponse)),
      ),

    findUserById: (req) =>
      runRpc(
        UserRepo.use((users) => users.findUserById(req.userId)).pipe(Effect.map(userResponse)),
      ),

    updateUser: (req) =>
      runRpc(
        Effect.gen(function* () {
          // proto の clearImage flag → null 変換は handler 責務 (repository は drizzle 列のまま受ける)。
          const updates: { name?: string; image?: string | null } = {};
          if (req.name !== undefined) updates.name = req.name;
          if (req.clearImage) {
            updates.image = null;
          } else if (req.image !== undefined) {
            updates.image = req.image;
          }

          if (Object.keys(updates).length === 0) {
            return yield* new RpcError({
              code: Code.InvalidArgument,
              message: "No fields to update",
            });
          }

          const users = yield* UserRepo;
          const row = yield* users.updateUser(req.userId, updates);
          if (!row) return yield* new RpcError({ code: Code.NotFound, message: "User not found" });

          return { user: toProtoUser(row) };
        }),
      ),

    deleteUser: (req) =>
      runRpc(
        Effect.gen(function* () {
          // 唯一の OWNER の ACTIVE 事業所が残っていると退会不可 (課金責任者不在を防ぐ。詳細: PR #55 → #63)。
          // pre-check と delete を同一 tx に置き、check 後に actor が OWNER 昇格される race を避ける。
          // tx の Transport 所有は ADR-0012 の Scope out のまま。
          const memberships = yield* MembershipRepo;
          const tx = yield* Transaction;
          const result = yield* tx.run(
            Effect.fn("rpc.deleteUser.apply")(function* (t) {
              const blocking = yield* memberships.findCompaniesBlockingUserDeletion(req.userId, t);
              if (blocking.length > 0) return { blocked: blocking.length };
              // user 不在でも tx は commit する (旧経路と同じ。判定は tx の外)。
              const row = yield* deleteAccount(req.userId, t);
              return { row };
            }),
          );
          if ("blocked" in result) {
            return yield* new RpcError({
              code: Code.FailedPrecondition,
              message: `cannot delete user: sole OWNER of ${result.blocked} active company(ies)`,
            });
          }
          if (!result.row)
            return yield* new RpcError({ code: Code.NotFound, message: "User not found" });
          return { success: true };
        }),
      ),
  });
}
