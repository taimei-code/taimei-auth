import { createMiddleware } from "hono/factory";

// COMMON_LOGIN_KILLSWITCH=1 で /auth/* と /api/auth/** を一括メンテ画面化する緊急ブレーキ。
// Phase 1 ロールアウト時に Layer B (新規実装) で致命バグが発生した場合、環境変数 1 つで
// 全プロダクトの共通ログイン経路を即座に停止できる。/rpc/* (verifySession) は対象外で
// 既存セッション保持機能は維持されるため、ログイン中ユーザーは引き続き taimei を利用可能。
//
// 挙動マトリクス:
// |                          | KILLSWITCH=0 | KILLSWITCH=1 | disable_common_login=1 |
// | /auth/* (Layer B)        | 通常配信      | 503 メンテ画面  | 503 メンテ画面          |
// | /api/auth/* (Better Auth)| 通常動作      | 503           | 503                    |
// | /rpc/* (verifySession)   | 通常動作      | 通常動作       | 対象外 (本 middleware が掛かっていないルート) |
// | /login (shortcut)        | 通常 302     | 503           | 503                    |
//
// disable_common_login=1 クエリは Sentry / Datadog 等の監視ツールが特定のフローを試す際に
// killswitch 状態を強制再現するための switch (KILLSWITCH=0 でも 503 を返却)。

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>メンテナンス中</title>
  </head>
  <body>
    <h1>共通ログイン メンテナンス中</h1>
    <p>しばらくお待ちください。</p>
  </body>
</html>`;

export const killswitch = createMiddleware(async (c, next) => {
  const envOn = process.env.COMMON_LOGIN_KILLSWITCH === "1";
  const queryOn =
    new URL(c.req.url).searchParams.get("disable_common_login") === "1";

  if (envOn || queryOn) {
    return new Response(MAINTENANCE_HTML, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  }

  await next();
});
