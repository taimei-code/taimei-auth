import { Hono } from "hono";

import { Sentry } from "../sentry";

// canary token 検知 endpoint。Layer B SignIn / SignUp 画面の 3 種埋込
// (不可視リンク / hidden input / favicon URL) からアクセスされた場合、Sentry に通報。
// 通常ユーザーが踏まないため、ヒットすればフィッシング・自動化 (DOM scraping / form auto-submit /
// favicon prefetch) の試行を疑える。
//
// 攻撃者にフィードバックを与えないため 204 No Content を返却 (favicon URL の場合も
// 透明な空ボディで content-type 不明のまま — favicon fetch 失敗としてブラウザは無視する)。
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
