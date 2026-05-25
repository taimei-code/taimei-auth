import type { ConnectRouter } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import { UserService } from "../gen/auth/v1/auth_pb";
import { runInTransaction } from "@/db/transaction";
import { appendAuditLog } from "@/db/repositories/audit-log";
import { findCompaniesBlockingUserDeletion } from "@/db/repositories/membership";
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
      // ADR-009 Q24: user が唯一の OWNER の ACTIVE 事業所が残っていると退会不可。
      // 退会すると課金責任者不在の事業所が生まれるため、先に委譲 / 削除を要求する。
      // pre-check と delete を同一 tx に置き、check 後に actor が OWNER 昇格される race を避ける。
      // 順序: pre-check → audit → revoke → delete。audit を delete 前に置くのは tx 失敗時に
      // audit だけ残るのを防ぐため。account_delete audit は compliance 必須のため失敗時 rethrow。
      // audit_log.user_id は FK なしのため (db/schema.ts) user cascade delete でも audit_log は残る。
      const result = await runInTransaction(async (tx) => {
        const blocking = await findCompaniesBlockingUserDeletion(req.userId, tx);
        if (blocking.length > 0) return { blocked: blocking.length };
        await appendAuditLog({ eventType: "account_delete", userId: req.userId, payload: {} }, tx);
        await revokeAllSessionsForUser(req.userId, tx);
        const row = await deleteUserRepo(req.userId, tx);
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
