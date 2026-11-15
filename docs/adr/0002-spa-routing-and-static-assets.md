# ADR-0002: 共通画面 SPA は単一 Vite build を `/auth/*` と `/account/*` の両方で配信する

## Context

**共通画面 SPA** (GLOSSARY.md) は Vite + React の SPA で、`web/dist` に build する。ルーティング上は **共通ログイン画面** が `/auth/` 配下、**アカウント管理画面** が `/account/` 配下にある。両者を別の SPA に分けず、1 つの build を 2 つのパスで配信し、route だけを SPA の router で分岐させたい。

## Decision

- Vite の `base` は `/auth/` に固定する (`web/vite.config.ts`)。生成される asset の URL (script や link の href) はすべて `/auth/assets/*` を指す。
- Hono は `/auth/*` を `serveStatic({ root: WEB_DIST, rewriteRequestPath: p => p.replace(/^\/auth/, "") })` で配信する。
- `/account/*` は SPA fallback handler が `web/dist/index.html` を返す。`/account` を訪れたブラウザが取りに行く `/auth/assets/*.js` は上の serveStatic で配信されるため、整合する。
- router (`web/src/app/router.tsx`) は **`basepath` を使わない**。route に `/auth` と `/account` の絶対パスを直接書く。Vite の `base` は asset URL の prefix のためのもので、Router のパス解決とは独立している。

### 拡張子付きのパスは SPA fallback しない

`/account/foo.js` のように拡張子のあるリクエストは asset として扱い、存在しなければ 404 を返す。SPA fallback で index.html を返すと、ブラウザがそれを script として解釈し、パースエラーで画面が壊れる。

### session に応じた redirect は serveStatic より前に置く

`/auth/` と `/auth/signup` でログイン済みの session を検知したら、`redirect_url` に直接 302 する 1 hop の最適化を行う (ログイン画面を再表示して改めてメールアドレスを入力させる冗長な UX を避けるため)。Hono の `serveStatic` はディレクトリパス (`/auth/`) に対して index.html を自動で返し、後続の handler には渡らない。そのため session に応じた redirect は `serveStatic` より前に登録する必要がある。

`/auth/error` と `/auth/verify-magic-link` は対象外である。`signup_already_completed` の表示や Magic Link の着地では、session があっても画面を表示する必要がある。

### router は TanStack Router (2026-10-11 追記)

(2026-11-07 追記) この節は [ADR-0023](./0023-web-foldkit.md) が置き換える。#396 で React の画面と TanStack Router を外した (ADR-0023 の Consequences)。この節は経緯として読む。document を読み直す理由は ADR-0023 も同じである。

- 選んだ理由: 遷移先の path と search が型検査され、存在しない path、定義していない search の値、必須の search の欠落への遷移が tsc で落ちる。search は route の `validateSearch` で 1 か所で parse し、遷移を起点とする処理 (`/account` を開く前の session と所属の確認、事業所登録の画面を開く前の確認、招待の受諾、MFA チャレンジの状態の取得) は route の `beforeLoad` / `loader` に置ける。React Router 8 は search の値と、`href()` を通さない path の誤りが型エラーにならなかった (draft PR #257 の PoC)
- `trailingSlash` は `preserve` にする。既定の `never` は `/auth/` を `/auth` に替え、上の session に応じた redirect (`/auth/` と `/auth/signup` だけが対象) を通らなくなる。逆に、ログアウトや退会の後に開くログイン画面は、意図して `/auth` (スラッシュ無し) にする。2 つの入口 (`leaveSpaToSignIn` と `signInUrlAfterSignOut`) は `web/src/shared/leave-spa.ts` が定義する
- `/auth` と `/account` をまたぐ遷移と、認証の状態が変わった後の遷移は、client 側の遷移ではなく document を読み直す (`reloadDocument`)。理由は 2 つある。session に応じた redirect は、document の要求でしか動かない。もう 1 つは cache の鮮度で、Effect Atom の registry (取得したデータの cache) に古い所属の一覧が残ったまま `/account` を開く前の確認がそれを読むと、事業所の作成や招待の受諾の直後でも事業所登録へ戻してしまう
- search の値は文字列のまま読む (`web/src/app/search-params.ts`)。router の既定は数字だけの値を数に、`true` を boolean に変え、consumer が渡す query が zod の検査で落ちる

### security の header は buildApp の最初の middleware で付ける (2026-11-15 追記、#463)

- CSP・`X-Frame-Options`・`Referrer-Policy` などの header は、`src/security-headers.ts` の `securityHeaders` を `buildApp` の最初の middleware に置いて付ける。Worker (`src/worker.ts`) と Bun (`testing/bun-server.ts`) の両方が `buildApp` を通るので、API・RPC・静的な file (`ASSETS.fetch` の応答を含む) のすべてに同じ値が付く。workerd の `ASSETS.fetch` の応答の headers は書き換えられる (`wrangler dev` で確かめた)
- CSP は `'self'` の allowlist にする。document は静的で inline の script が無く、nonce や hash を差す仕組みが要らない。外の origin を許すのは `img-src` と `connect-src` だけである。`img-src` の `data:` は MFA の QR コード (`data:` URL) のため、`https://avatars.githubusercontent.com` と `https://*.public.blob.vercel-storage.com` は avatar (GitHub のログインで得た画像と、upload した画像) のため。`https:` 全体を許すと、差し込まれた `<img>` が任意の host へ値を送れる。`connect-src` の `https://vercel.com` は、avatar の upload (`@vercel/blob/client` の `upload`) が `https://vercel.com/api/blob` に要求を出すため
- hono の既定から 3 つの値を変える。`Strict-Transport-Security` は `max-age=86400` で `includeSubDomains` を付けない (長い max-age は誤った時に browser の cache が切れるまで戻せないので、短く始めて様子を見る)。`Cross-Origin-Opener-Policy` は `same-origin-allow-popups` (GitHub の OAuth のような、画面が開く popup を壊さない)。`Permissions-Policy` は camera・microphone・geolocation・payment・usb を止める (画面が使わない)。document の `<meta name="referrer">` は、header と同じ値を 2 か所に持たないよう外した
- `Cross-Origin-Resource-Policy` は付けない (hono の既定の `same-origin` を外す)。ほかの origin が `/auth/assets/*` や canary の icon を読んでいないかを確かめていないためで、#477 で決める
- sign-out の成功の応答には `Clear-Site-Data: "cache", "storage"` を付ける。`"cookies"` は応答の登録 domain 全体 (consumer の subdomain を含む) の cookie を消すので入れない。session の cookie は better-auth の sign-out が `Set-Cookie` で消す
- zod 4 は schema を作る時に `Function("")` で eval を使えるかを試し、CSP の下ではこれが違反として報告される。SPA の 2 つの application の entry (`web/src/app/*/entry.ts`) の最初で `web/src/shared/zod-jitless.ts` を import し、schema を作る前に試しを止める。bundle の root (`web/src/main.ts`) に置くと zod の一部が entry の chunk に写り、本番の JS が `acceptance/drop-react.test.ts` の AC-009 の上限を超える

## Why

- 1 つの build で済むので、bundle や chunk hash の重複を避けられる
- **auth ホスト** の serveStatic の配置を 1 箇所に集約できる
- `/account` を「**共通画面 SPA** 内のサブ画面」として、GLOSSARY.md の **session-aware redirect** と **`/login` ショートカット** に整合させやすい

## Consequences

- `/auth` と `/account` を別の build に分けたくなったらこの ADR を再検討する。現状の chunk size に問題はない。
- 拡張子の検知は正規表現 `/\.[a-zA-Z0-9]+$/` で行う。`favicon.ico` や `apple-touch-icon.png` などのルート直下への参照は、別の Hono ハンドラで処理する設計である。
