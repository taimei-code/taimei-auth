import type { Context } from "hono";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { auth } from "../auth";

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
    onUploadCompleted: async () => {},
  });

  return c.json(jsonResponse);
};
