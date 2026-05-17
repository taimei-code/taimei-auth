import type { ConnectRouter } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import { UserService } from "../gen/auth/v1/auth_pb";
import { runInTransaction } from "@/db/transaction";
import { appendAuditLog } from "@/db/repositories/audit-log";
import { revokeAllSessionsForUser } from "@/db/repositories/session";
import {
  deleteUser as deleteUserRepo,
  findUserByEmail as findUserByEmailRepo,
  findUserById as findUserByIdRepo,
  updateUser as updateUserRepo,
} from "@/db/repositories/user";
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
      // 順序: audit → revoke → delete を同一 tx で atomic 実行。
      // audit を先頭に置く理由: tx 失敗時に audit だけ残るのを防ぐ。
      // account_delete audit は compliance 観点で必須のため失敗時 rethrow (sign-in / sign-out と異なる方針)。
      // audit_log.user_id は FK なしのため (db/schema.ts) user cascade delete でも audit_log は残る。
      const row = await runInTransaction(async (tx) => {
        await appendAuditLog({ eventType: "account_delete", userId: req.userId, payload: {} }, tx);
        await revokeAllSessionsForUser(req.userId, tx);
        return deleteUserRepo(req.userId, tx);
      });
      if (!row) {
        throw new ConnectError("User not found", Code.NotFound);
      }
      return { success: true };
    },
  });
}
