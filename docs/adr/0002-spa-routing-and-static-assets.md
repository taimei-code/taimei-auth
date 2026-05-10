# ADR-0002: 共通画面 SPA は単一 Vite build を `/auth/*` と `/account/*` の両方で配信する

## Context

**共通画面 SPA** (CONTEXT.md) は Vite + React の SPA で `web/dist` に build する。ルーティング上は **共通ログイン画面** が `/auth/`, **アカウント管理画面** が `/account/` 配下にある。両者は別 SPA に分けず、1 build を 2 path で配信して route だけ React Router で分岐させたい。

## Decision

- Vite の `base` は `/auth/` 固定 (`web/vite.config.ts`)。生成 asset URL (script / link href) はすべて `/auth/assets/*` を指す。
- Hono は `/auth/*` を `serveStatic({ root: WEB_DIST, rewriteRequestPath: p => p.replace(/^\/auth/, "") })` で配信。
- `/account/*` は SPA fallback handler が `web/dist/index.html` を返す。`/account` 訪問時にブラウザが取りに行く `/auth/assets/*.js` は上の serveStatic で配信されるため整合する。
- React Router (`web/src/App.tsx`) は **`basename` を使わない**。`Routes` に `/auth` `/account` の絶対 path を直接書く。Vite `base` は asset URL prefix のためで Router の path 解決とは独立。

### 拡張子付き path は SPA fallback しない

`/account/foo.js` のように拡張子のあるリクエストは asset として扱い、存在しなければ 404 を返す。SPA fallback で index.html を返すと、ブラウザが script として解釈してパースエラーで画面が破綻する。

### session-aware redirect は serveStatic より前に置く

`/auth/` `/auth/signup` でログイン済 session を検知したら `redirect_url` に直接 302 する 1 hop 最適化を行う (login 画面の再表示で改めてメアド入力させる冗長 UX を回避)。Hono `serveStatic` は directory path (`/auth/`) に対して index.html を auto-serve するため、後続 handler に渡らない。session-aware redirect を `serveStatic` より前に登録する必要がある。

`/auth/error` `/auth/verify-magic-link` は対象外: `signup_already_completed` 表示や Magic Link 着地で session 有でも画面表示が必要。

## Why

- 1 build で済むので bundle / chunk hash の重複を避けられる
- **auth ホスト** の serveStatic 配置を 1 箇所に集約できる
- `/account` を「**共通画面 SPA** 内のサブ画面」として CONTEXT.md の **session-aware redirect** / **`/login` ショートカット** と整合させやすい

## Consequences

- `/auth` と `/account` を別 build に分けたくなったら本 ADR を再検討する。現状 chunk size に問題なし。
- 拡張子検知は正規表現 `/\.[a-zA-Z0-9]+$/` で行う。`favicon.ico` や `apple-touch-icon.png` 等のルート参照は別途 Hono ハンドラで処理する設計。
