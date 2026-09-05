import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { Effect } from "effect";
import { Hono } from "hono";

import { requireActor } from "../membership/guard";
import { runRoute } from "./run-route";

const ALLOWED_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

// 他の /api/account/* と同じく guard 層 (requireActor) を通す。素の getSession 判定だと cookieCache
// (最大 5 分) の窓内で削除済み user にも upload token を発行してしまう (guard は fail-closed で 401)。
export const accountAvatar = new Hono();

accountAvatar.post("/api/account/avatar/upload-token", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const jsonResponse = yield* Effect.promise(async () => {
        const body = (await c.req.json()) as HandleUploadBody;
        return handleUpload({
          body,
          request: c.req.raw,
          onBeforeGenerateToken: async () => ({
            allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
            addRandomSuffix: true,
            maximumSizeInBytes: MAX_SIZE_BYTES,
            tokenPayload: JSON.stringify({ userId: actor.id }),
          }),
          onUploadCompleted: async () => {},
        });
      });
      return c.json(jsonResponse);
    }),
  ),
);
