import type { ConnectRouter } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import { UserService } from "../gen/auth/v1/auth_pb";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

export function registerUserService(router: ConnectRouter) {
  router.service(UserService, {
    async findUserByEmail(req) {
      const result = await db
        .select()
        .from(user)
        .where(eq(user.email, req.email))
        .then((rows) => rows.at(0));

      if (!result) {
        return { user: undefined };
      }

      return {
        user: {
          id: result.id,
          name: result.name,
          email: result.email,
          emailVerified: result.emailVerified,
          image: result.image ?? undefined,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        },
      };
    },

    async findUserById(req) {
      const result = await db
        .select()
        .from(user)
        .where(eq(user.id, req.userId))
        .then((rows) => rows.at(0));

      if (!result) {
        return { user: undefined };
      }

      return {
        user: {
          id: result.id,
          name: result.name,
          email: result.email,
          emailVerified: result.emailVerified,
          image: result.image ?? undefined,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        },
      };
    },

    async updateUser(req) {
      const updates: Record<string, unknown> = {};
      if (req.name !== undefined) updates.name = req.name;
      if (req.clearImage) {
        updates.image = null;
      } else if (req.image !== undefined) {
        updates.image = req.image;
      }

      if (Object.keys(updates).length === 0) {
        throw new ConnectError("No fields to update", Code.InvalidArgument);
      }

      const result = await db
        .update(user)
        .set(updates)
        .where(eq(user.id, req.userId))
        .returning()
        .then((rows) => rows.at(0));

      if (!result) {
        throw new ConnectError("User not found", Code.NotFound);
      }

      return {
        user: {
          id: result.id,
          name: result.name,
          email: result.email,
          emailVerified: result.emailVerified,
          image: result.image ?? undefined,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        },
      };
    },

    async deleteUser(req) {
      const result = await db.delete(user).where(eq(user.id, req.userId)).returning();

      if (result.length === 0) {
        throw new ConnectError("User not found", Code.NotFound);
      }

      // session, account は CASCADE で自動削除
      return { success: true };
    },
  });
}
