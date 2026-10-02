import type { ConnectRouter } from "@connectrpc/connect";
import { Code } from "@connectrpc/connect";
import { Effect } from "effect";
import { deleteAccountUnlessLastOwner } from "../account/delete-account";
import { UserRepo } from "../account/ports";
import { UserService } from "../gen/auth/v1/auth_pb";
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
        deleteAccountUnlessLastOwner(req.userId).pipe(
          Effect.catchTag(
            "NotFound",
            () => new RpcError({ code: Code.NotFound, message: "User not found" }),
          ),
          Effect.as({ success: true }),
        ),
      ),
  });
}
