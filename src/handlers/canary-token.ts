import { Effect } from "effect";
import { Hono } from "hono";

import { SentryService } from "../sentry";
import { runRoute } from "./run-route";

// 共通画面 SPA 3 経路埋込からの canary token 受信。詳細: docs/adr/0005-canary-token-embedding.md
export const canaryToken = new Hono();

const FAVICON_EMBED_SUFFIX = ".ico";

canaryToken.get("/auth/canary-token/:token", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const sentry = yield* SentryService;
      const tokenParam = c.req.param("token");
      const isFaviconEmbed = tokenParam.endsWith(FAVICON_EMBED_SUFFIX);
      const tokenId = isFaviconEmbed
        ? tokenParam.slice(0, -FAVICON_EMBED_SUFFIX.length)
        : tokenParam;

      yield* sentry.captureMessage("Canary token triggered", {
        level: "warning",
        tags: {
          token_id: tokenId,
          embed_type: isFaviconEmbed ? "favicon" : "link-or-form",
        },
        extra: {
          url: c.req.url,
          userAgent: c.req.header("user-agent") ?? "unknown",
          referer: c.req.header("referer") ?? "unknown",
        },
      });

      return new Response(null, { status: 204 });
    }),
  ),
);
