# ADR-0002: 共通画面 SPA は単一 Vite build を `/auth/*` と `/account/*` の両方で配信する

## Context

**共通画面 SPA** (CONTEXT.md) は Vite + React の SPA で、`web/dist` に build する。ルーティング上は **共通ログイン画面** が `/auth/` 配下、**アカウント管理画面** が `/account/` 配下にある。両者を別の SPA に分けず、1 つの build を 2 つのパスで配信し、route だけを React Router で分岐させたい。

## Decision

- Vite の `base` は `/auth/` に固定する (`web/vite.config.ts`)。生成される asset の URL (script や link の href) はすべて `/auth/assets/*` を指す。
- Hono は `/auth/*` を `serveStatic({ root: WEB_DIST, rewriteRequestPath: p => p.replace(/^\/auth/, "") })` で配信する。
- `/account/*` は SPA fallback handler が `web/dist/index.html` を返す。`/account` を訪れたブラウザが取りに行く `/auth/assets/*.js` は上の serveStatic で配信されるため、整合する。
- React Router (`web/src/app/App.tsx`) は **`basename` を使わない**。`Routes` に `/auth` と `/account` の絶対パスを直接書く。Vite の `base` は asset URL の prefix のためのもので、Router のパス解決とは独立している。

### 拡張子付きのパスは SPA fallback しない

`/account/foo.js` のように拡張子のあるリクエストは asset として扱い、存在しなければ 404 を返す。SPA fallback で index.html を返すと、ブラウザがそれを script として解釈し、パースエラーで画面が壊れる。

### session に応じた redirect は serveStatic より前に置く

`/auth/` と `/auth/signup` でログイン済みの session を検知したら、`redirect_url` に直接 302 する 1 hop の最適化を行う (ログイン画面を再表示して改めてメールアドレスを入力させる冗長な UX を避けるため)。Hono の `serveStatic` はディレクトリパス (`/auth/`) に対して index.html を自動で返し、後続の handler には渡らない。そのため session に応じた redirect は `serveStatic` より前に登録する必要がある。

`/auth/error` と `/auth/verify-magic-link` は対象外である。`signup_already_completed` の表示や Magic Link の着地では、session があっても画面を表示する必要がある。

## Why

- 1 つの build で済むので、bundle や chunk hash の重複を避けられる
- **auth ホスト** の serveStatic の配置を 1 箇所に集約できる
- `/account` を「**共通画面 SPA** 内のサブ画面」として、CONTEXT.md の **session-aware redirect** と **`/login` ショートカット** に整合させやすい

## Consequences

- `/auth` と `/account` を別の build に分けたくなったらこの ADR を再検討する。現状の chunk size に問題はない。
- 拡張子の検知は正規表現 `/\.[a-zA-Z0-9]+$/` で行う。`favicon.ico` や `apple-touch-icon.png` などのルート直下への参照は、別の Hono ハンドラで処理する設計である。
