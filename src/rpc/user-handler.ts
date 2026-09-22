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
          // 事前チェックと delete を同じ tx に置き、チェック後に actor が OWNER へ昇格される race を避ける。
          const memberships = yield* MembershipRepo;
          const tx = yield* Transaction;
          const row = yield* tx.run(
            Effect.fn("rpc.deleteUser.apply")(function* (t) {
              const blocking = yield* memberships.findCompaniesBlockingUserDeletion(req.userId, t);
              if (blocking.length > 0) {
                return yield* new RpcError({
                  code: Code.FailedPrecondition,
                  message: `cannot delete user: sole OWNER of ${blocking.length} active company(ies)`,
                });
              }
              return yield* deleteAccount(req.userId, t);
            }),
          );
          // NotFound は tx の外で判定する (tx 内で失敗にすると deleteAccount の audit 行まで rollback される)。
          if (!row) return yield* new RpcError({ code: Code.NotFound, message: "User not found" });
          return { success: true };
        }),
      ),
  });
}
