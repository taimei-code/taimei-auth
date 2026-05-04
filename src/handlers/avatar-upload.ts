import type { Context } from "hono";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { auth } from "../auth";

// Vercel Blob client upload の Server-side endpoint。
// クライアント (@vercel/blob/client の upload()) がここに POST して signed token を取得 →
// 直接 Vercel Blob に PUT、URL 取得後にクライアントが authClient.updateUser({ image: url }) で保存。
//
// 認証ガード: Better Auth Cookie 検証で未ログインなら 401。
// セキュリティ: contentType を image/{png,jpeg,webp} に制限、5MB 上限、ファイル名にランダム接尾辞付与
// (パス予測 / 上書き攻撃の防止)。
const ALLOWED_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const avatarUploadHandler = async (c: Context) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = (await c.req.json()) as HandleUploadBody;
  const jsonResponse = await handleUpload({
    body,
    request: c.req.raw,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
      addRandomSuffix: true,
      maximumSizeInBytes: MAX_SIZE_BYTES,
      tokenPayload: JSON.stringify({ userId: session.user.id }),
    }),
    onUploadCompleted: async () => {
      // クライアント側で authClient.updateUser({ image }) するため server-side では noop。
      // 将来的に DB へ avatar 履歴を残す場合はここに記録。
    },
  });

  return c.json(jsonResponse);
};
