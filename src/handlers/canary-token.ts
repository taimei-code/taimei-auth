import { Hono } from "hono";

import { Sentry } from "../sentry";

// 共通画面 SPA 3 経路埋込からの canary token 受信。詳細: docs/adr/0005-canary-token-embedding.md
export const canaryToken = new Hono();

canaryToken.get("/auth/canary-token/:token", (c) => {
  const tokenParam = c.req.param("token");
  const tokenId = tokenParam.replace(/\.ico$/, "");

  Sentry.captureMessage("Canary token triggered", {
    level: "warning",
    tags: {
      token_id: tokenId,
      embed_type: tokenParam.endsWith(".ico") ? "favicon" : "link-or-form",
    },
    extra: {
      url: c.req.url,
      userAgent: c.req.header("user-agent") ?? "unknown",
      referer: c.req.header("referer") ?? "unknown",
    },
  });

  return new Response(null, { status: 204 });
});
