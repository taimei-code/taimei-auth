import type { ConnectRouter } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import { UserService } from "../gen/auth/v1/auth_pb";
import { runInTransaction } from "@/db/transaction";
import { findCompaniesBlockingUserDeletion } from "@/db/repositories/membership";
import {
  findUserByEmail as findUserByEmailRepo,
  findUserById as findUserByIdRepo,
  updateUser as updateUserRepo,
} from "@/db/repositories/user";
import { deleteAccount } from "../account/delete-account";
import { toProtoUser } from "./mappers";

export function registerUserService(router: ConnectRouter) {
  router.service(UserService, {
    async findUserByEmail(req) {
      const row = await findUserByEmailRepo(req.email);
      if (!row) return { user: undefined };
      return { user: toProtoUser(row) };
    },

    async findUserById(req) {
      const row = await findUserByIdRepo(req.userId);
      if (!row) return { user: undefined };
      return { user: toProtoUser(row) };
    },

    async updateUser(req) {
      // proto の clearImage flag → null 変換は handler 責務 (repository は drizzle 列のまま受ける)。
      const updates: { name?: string; image?: string | null } = {};
      if (req.name !== undefined) updates.name = req.name;
      if (req.clearImage) {
        updates.image = null;
      } else if (req.image !== undefined) {
        updates.image = req.image;
      }

      if (Object.keys(updates).length === 0) {
        throw new ConnectError("No fields to update", Code.InvalidArgument);
      }

      const row = await updateUserRepo(req.userId, updates);
      if (!row) {
        throw new ConnectError("User not found", Code.NotFound);
      }

      return { user: toProtoUser(row) };
    },

    async deleteUser(req) {
      // 唯一の OWNER の ACTIVE 事業所が残っていると退会不可 (課金責任者不在を防ぐ。詳細: PR #55 → #63)。
      // pre-check と delete を同一 tx に置き、check 後に actor が OWNER 昇格される race を避ける。
      const result = await runInTransaction(async (tx) => {
        const blocking = await findCompaniesBlockingUserDeletion(req.userId, tx);
        if (blocking.length > 0) return { blocked: blocking.length };
        const row = await deleteAccount(req.userId, tx);
        return { row };
      });
      if ("blocked" in result) {
        throw new ConnectError(
          `cannot delete user: sole OWNER of ${result.blocked} active company(ies)`,
          Code.FailedPrecondition,
        );
      }
      if (!result.row) {
        throw new ConnectError("User not found", Code.NotFound);
      }
      return { success: true };
    },
  });
}
