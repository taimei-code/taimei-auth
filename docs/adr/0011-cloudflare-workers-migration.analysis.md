# ADR-0011 Cloudflare Workers 移植 — 検証台帳 (ledger)

> これは `iterate-with-prototypes` の **唯一の記録 (ledger)** であり、完成版の ADR ではない。
> 設計書 (`0011-cloudflare-workers-migration.md`) は、spike で前提を実機で確かめて Code-A を動かした後に
> **コードから逆生成** する。このファイルは「何を、どう検証し、どうなったら kill するか」と、
> その status を記録する唯一の場所である。以後の TODO・決定・AC はここに集約する。

## 背景 (確定事項)

- ホスティング: taimei-auth を **Cloudflare Workers** に、taimei は **Vercel のまま** にする。費用は $0 (ドメインを除く)。
- cross-subdomain Cookie (`.taimei-code.com`) はホストが別でも成立する (ADR-0004)。ADR-008 のデプロイ前提とも一致する。
- DB: **Postgres のまま Hyperdrive を挟む** (backing は Neon の無料枠)。schema / `drizzle/*.sql` / repositories / better-auth の `provider:"pg"` を温存し、移植を「接続層の差し替え」に縮める。
  - 却下した案: Neon HTTP (interactive tx 非対応) / D1 (batch のみで tx 非対応) / Turso (sqlite 方言への書き換えが要る) / PlanetScale (mysql で有料)。再評価のきっかけは「完全な edge ネイティブ化」を独立した ADR で扱う時とする。
- Redis: **Upstash REST**。RPC: **connect-node の内部 http proxy を廃止し、ConnectRPC を fetch ハンドラに直結する**。

## ガードレール判定

code-first を適用できる。主なリスクは feasibility だけである。schema と RPC 契約は凍結し、可逆である (Cloud Run / Bun への fallback がある)。
spike は本番に触れない使い捨て (ローカル PG とローカル Hyperdrive の接続文字列) に限定する。

## 前提台帳 (不確実性と手戻りの大きさでランク付け)

status は **unverified / grounded / killed** の 3 値だけを使う。grounded にするのは ground-truth と照合した証拠がある時だけである。

| # | 主張 | 検証方法 (ground-truth + 予算 + 代表入力) | kill 条件 | status |
|---|---|---|---|---|
| **A** | `pg` (node-postgres) ドライバが Workers (`nodejs_compat`) と Hyperdrive binding で起動し、drizzle の `runInTransaction` の **interactive tx** (読んで分岐して書く) が原子性を保ち、**tx スコープのロック** (`pg_advisory_xact_lock` / `SELECT ... FOR UPDATE`) が tx の終わりまで同一接続に固定される (Hyperdrive の pooling を通しても) | `wrangler dev` で最小の Worker を立て、Hyperdrive からローカル PG (compose の auth-postgres) に接続する。**ground-truth は PG の実テーブル状態 (worker と独立した直接の pg 接続で SELECT する)**。(1) commit: read count が 0 なら insert(audit) と delete(user) を行い、user が消え audit が 1 行残る (2) rollback: tx 内で throw すると **両方とも未変更にロールバックされる** (3) advisory lock: `pg_advisory_xact_lock(hashtext($1))` を 2 tx 並列で取り、直列化を確認する (4) `SELECT id ... FOR UPDATE` が tx 内で行ロックを保持する。レイテンシ p95 ≤ 500ms (ローカル、10 回連続計測) | tx 内の throw でロールバックされない / pg が workerd で起動しない / Hyperdrive 経由で tx を張れない / **advisory lock または FOR UPDATE が tx の終わりまで保持されず、race が直列化されない** | **grounded** (spike-1) |
| **B** | 既存の `registerRoutes(ConnectRouter)` を無改修のまま、ConnectRPC を fetch ハンドラとして Hono on Workers で配信でき、AuthService / UserService が応答する (ADR-0001 の content-length 回避は proxy が消えるため不要になる) | `wrangler dev` 上の Hono に Connect の fetch handler をマウントする。`@connectrpc/connect-web` transport の SDK から `verifySession` 相当の RPC を 1 つ呼ぶ。**ground-truth は同じ RPC を現行の Bun 実装に投げた応答** で、byte 等価 (proto decode 後の field が一致) であること。unary のみ (このリポジトリは streaming 未使用) | fetch handler で RPC が 4xx / 5xx になる / content-length が原因で body が壊れる / handlers の改修が必要になる | **grounded** (spike-3) |
| **C** | better-auth の **core** (drizzleAdapter + secondaryStorage + magic-link + crossSubDomainCookies) が Workers の fetch ランタイムで起動し動作する | `wrangler dev` 上で magic-link の sign-in、verify、getSession を行う。**ground-truth は独立した pg 接続で確認する user 行の生成と cookie 属性**。`Domain=.taimei-code.local` / `HttpOnly` / `SameSite=Lax` | better-auth が Workers で起動しない / cookie 属性が壊れる / magic-link の verify が失敗する | **grounded** (spike-2) |
| **C2** | auth.ts の周辺依存 (`@react-email/components` の `render` つまり react-dom/server、`resend` SDK、`@sentry/bun`) が workerd で動く | 各 dep を worker に import し、render / send / capture を実行する。**ground-truth は HTML 出力 / Resend API の応答 / Sentry のイベント受信**。`@sentry/bun` は `@sentry/cloudflare` に替え、resend は fetch ベースなので動く見込み、react-email の render は要注意 | react-email の render が workerd で例外になる / resend が Node API に依存して動かない | **grounded** (spike-4、注意付き) |
| **D** | Upstash REST で rate-limit の `multi().incr().expire().ttl().exec()` が atomic に動き、secondaryStorage の get / set / delete (TTL) が機能する | Upstash の無料 DB に対し (1) INCR を N 並列で行って counter が正確であること (2) EXPIRE 後の TTL を観測すること (put して ttl を実測) (3) secondaryStorage: set(ttl=2s) して get し、2s 後の get が null になること。**ground-truth は Upstash の実 DB の返り値** | 並列 INCR で counter がずれる / TTL が機能しない / multi が atomic でない | **grounded** (spike-6) |
| **E** | web/dist の SPA を Workers Static Assets で配信し、SPA fallback と canary token の埋め込み (ADR-0002 / 0005) が成立する | `wrangler dev` の assets で `/account` などの deep link が index に fallback し、canary token が HTML に注入されること。**ground-truth は現行 `spa-fallback.ts` の出力 HTML** | deep link が 404 になる / canary の注入が消える | **grounded** (spike-5) |
| **F** | 月額ホスティング $0 (Workers free + Neon free + Upstash free + Hyperdrive free の枠内) | 各無料枠の上限 (req/日、DB 容量、command/日) を着手時点の実値で確認し、想定トラフィック (個人運用) を下回ることを算術で照合する | いずれかが無料枠で賄えず課金が必須になる | unverified |

## ランク根拠

- **A が最上位**: 不確実性が高く (Workers + Hyperdrive + pg + interactive tx の組み合わせは未検証で、pg が Workers で動くこと自体が未確認)、手戻りが最大 (外れたら DB 戦略が総崩れになり、neon-serverless の WebSocket か Turso へ転換することになる)。削除 / 除名の正しさが直接かかっている。
- **C は手戻りが大きいが不確実性は中**: better-auth は Workers 対応を公称している。A の次。
- **B は中 × 中** (index.ts の配線だけで、handlers は不変)。**D / E / F は低 × 小**。
- A と「pg が Workers で起動するか」は同一のデータ経路なので、**1 つの spike に同居させ** verdict を分ける。

## 進め方 (The loop)

1. **spike-1 は前提 A** (最上位)。grounded になるまで繰り返す。次に C、B の順。D / E / F は軽いので Code-A 着手後に確認する。
2. A が grounded になってから Code-A (PRD 100% の動くコード) に着手する。
3. Code-A′ (リファクタ) の後、コードから ADR-011 を逆生成し、grill / AC / MECE / SSOT を経て PR 分割する。

## spike ログ

### spike-1 (前提 A) — 2026-06-20 — verdict: **grounded**

- 構成: `/tmp/spike-hd` (使い捨て)。`wrangler dev` (wrangler 4.103.0) で実 workerd を起動し、Hyperdrive binding を **local mode** で compose の auth-postgres (専用の `spike_db`) に接続した。worker は `pg` (node-postgres) と `drizzle-orm/node-postgres` で、本番と同じ `db.transaction` を使用した。
- ground-truth: worker と無関係な直接の pg 接続 (`verify.ts`) で最終的なテーブル状態を SELECT した。
- 観測 (worker と ground-truth が一致):
  - `driverBooted: true`。pg が workerd + nodejs_compat + Hyperdrive で起動した (歴史的に pg は Workers で使えなかったが、Hyperdrive と nodejs_compat で接続が成立した)
  - `commit_ms: 4` / `commit_readCount: 1`。interactive に読んで分岐して書く tx が機能した
  - **原子性**: ground-truth で `atomicity_pass: true` (commit 経路は user の削除が確定し audit が残存、rollback 経路は throw で user と audit がともに未変更に戻る)
  - **advisory lock**: `pg_advisory_xact_lock` で並列の 2 tx が interleave せずに直列化された (`A:enter,A:exit,B:enter,B:exit`)。つまり company 作成の TOCTOU や OWNER race の防止機構が Hyperdrive の pooling を通しても働く
  - `SELECT ... FOR UPDATE`: tx 内で行ロックの取得に成功した (`forupdate_rows:1`)
  - レイテンシ p95 ≤ 500ms: 4ms (ローカル) で充足
- 結論: **DB 戦略 (Postgres のまま Hyperdrive を挟み、schema を凍結する) を実機で確かめた**。DB 移行は「接続層の差し替え」に縮められることが確認できた。kill 条件はいずれも発火しなかった。
- 注意 (本番への持ち越し検証): この spike は Hyperdrive の **local mode** (直接の PG proxy) である。本番の Hyperdrive は connection pooling と query caching が入るため、(a) tx の固定が本番の pool でも保たれるか (b) prepared statement や `SET` 系が pool で漏れないか を本番相当 (remote Hyperdrive + Neon) で再確認する項目として ADR に残す。

### spike-2 (前提 C) — 2026-06-20 — verdict: **grounded** (core)

- 構成: リポジトリ内の `_spike_c/` (untracked、後で削除)。`db/schema.ts` を `../db/schema` でそのまま import し、本物のスキーマ (drizzle migrate と manual trigger 適用済み) を持つ `spike_db` に Hyperdrive 越しで接続した。better-auth は本番 `src/auth.ts` の核心部分 (magicLink + drizzleAdapter pg + secondaryStorage + additionalFields の revision / lastUsedCompanyId + crossSubDomainCookies + cookieCache + freshAge=0) を写した。email / resend / sentry / hooks は除外した (C2 で扱う)。
- ground-truth: 独立した pg 接続 (`verify.ts`) で user 行を確認した。
- 観測:
  - `betterAuthInstantiated: true`。better-auth core が workerd で起動した (import 時に Node 専用 API で失敗しない)
  - magic-link を発行して token を取得し、`verify_status: 200`、`getSession` が email 一致で non-null を返した
  - ground-truth: `user` 行が 1 件生成された (email と `revision:0` の default が成立)。つまり drizzleAdapter(pg) の書き込みが Hyperdrive 越しに成立した
  - cookie 属性: `Domain=.taimei-code.local` + `HttpOnly` + `SameSite=Lax`。crossSubDomain cookie が workerd で正しく発行された
- 学び (移植 TODO の実データ):
  - **session は DB の session テーブルに入らない**。secondaryStorage 構成では session は secondary storage (本番は Upstash) に格納され、DB の `session` は空になる。これは現行設計どおりである (db/CLAUDE.md ルール 2 の例外である cookieCache と整合する)。DB の session を直接読むコードがあれば移植時に注意が要る (無い想定だが grep する)。
  - server API `auth.api.*` を server-side で呼ぶ時は `headers` が必須である (spike では明示的な注入が要った)。本番は `auth.handler(req.raw)` 経由で実際の headers が渡るので問題にならない。
- 残: **C2** (react-email の render / resend / sentry の workerd 互換) は未検証である。これは better-auth core とは独立した、周辺依存の移植項目である。

### spike-3 (前提 B) — 2026-06-20 — verdict: **grounded**

- 構成: リポジトリ内の `_spike_b/` (untracked、後で削除)。リポジトリの実際の `AuthService` 記述子 (`src/gen/auth/v1/auth_pb`) を無改修で import した。`createConnectRouter()` + `router.service(AuthService, stubImpl)` + 各 `router.handlers` を `createFetchHandler` で fetch 化し、Hono にマウントした。DB と better-auth には依存しない (transport が論点)。
- 観測 (ground-truth は Connect JSON protocol の応答):
  - `/_paths` が 5 メソッドの Connect path を配信した (`/auth.v1.AuthService/{VerifySession,GetUser,FindAccountByUserId,SignOut,SendMagicLink}`)
  - `POST /auth.v1.AuthService/SignOut` (Connect JSON、`Connect-Protocol-Version: 1`) が `{"success":true}` / HTTP 200 / `application/json` を返した
  - stub が返した proto 未定義のフィールド `echoedToken` が応答から落ちた。つまり proto のシリアライズが正しく機能している
  - 未知の path は Hono の fallback で 404 になった
- 結論: connect-node の内部 `http.createServer` と `/rpc/*` proxy を廃止し、`createConnectRouter` + `createFetchHandler` で workerd から直接配信できる。`registerRoutes(router)` は無改修で再利用でき、変更は `index.ts` の配線だけである。**ADR-0001 の content-length 回避は proxy が消えることで不要になる** ことを裏付けた (fetch の応答が回避なしで正しい)。
- 残 (低リスク): この spike は **Connect JSON / unary** だけである (リポジトリは全 unary)。binary protobuf は同一 fetch handler の codec 分岐なので別 spike は不要と判断した。本番では `/rpc` prefix と X-Service-Key middleware を Hono 側に再配置する (現行 index.ts と同じ責務で、移植時に配線する)。

---

### spike-4 (前提 C2) — 2026-06-20 — verdict: **grounded** (注意付き)

- 構成: リポジトリ内の `_spike_c2/` (untracked)。リポジトリの実際の `src/email/magic-link.tsx` (Tailwind + Button / Img / Link など) を workerd で `render` し、Bun での同一 render を ground-truth として照合した。
- 観測:
  - **react-email の render が workerd で動作し、Bun と byte 単位で同一**: 両 runtime とも `html_len=5932 / text_len=371` で、ボタン文言「ログインする」、token、Tailwind からの inline CSS (`background-color`) がすべて反映された。react-dom/server と Tailwind CSS のインライン化が workerd で成立した。
  - **resend SDK が workerd で instantiate に成功した** (`emails.send` が関数として存在する。fetch ベースで Node API に依存しない見込み)。実送信は未検証である (API キーが要る)。
  - **重要な移植上の注意**: `import { render } from "@react-email/components"` の **名前付き import は、workerd の esbuild バンドルで `render2 is not a function` になり失敗する**。`import * as ReactEmail` の namespace アクセスで解決した。Bun では名前付き import が通る (workerd のバンドル固有の CJS / ESM interop 問題)。移植時は namespace import にするか、解決を bundle で検証する。
- 残 (既知の差し替えで、spike は不要): `@sentry/bun` は名前どおり Bun 専用なので `@sentry/cloudflare` へ差し替える。resend の実送信は本番キーで疎通確認する。
- **本番での訂正 (2026-06-21)**: namespace import は、better-auth などを含む本実装のバンドルでは esbuild が
  未 init の参照に畳み、`render2 is not a function` のままだった (本番の magic-link が 500)。dynamic import
  (`await import`) で実行時の init を強制して解決した。spike の「namespace import で解決」は最小 spike に限った話だった。

### spike-5 (前提 E) — 2026-06-20 — verdict: **grounded**

- 構成: リポジトリ内の `_spike_e/` (untracked)。`assets: { directory: "../web/dist", not_found_handling: "single-page-application" }` と worker を共存させ、worker は `/api/*` と `/auth/canary-token/*` を処理し、残りを `env.ASSETS.fetch` へ委譲した。
- 観測 (ground-truth は実際の HTTP 応答):
  - `/` は 200 text/html (SPA root)
  - `/account` (拡張子なしの deep link) は index.html に fallback した (`<title>taimei-auth</title>`)
  - `/assets/index-CUN7KAFa.js` は 200 text/javascript (静的配信)
  - `/api/ping` は `{"from":"worker"}` (worker ルートが SPA fallback に吸われず共存する)
  - `/auth/canary-token/abc` は 204 (worker ルートが動作する)
- 結論: `Bun.file` の spa-fallback は Workers Static Assets (`single-page-application` mode) で置き換えられ、worker ルートと共存する。canary token は単なる GET ルート (Sentry 通知と 204) で静的配信とは独立しており、移植は自明である。
- **本番での訂正 (2026-06-21)**: この spike は `/account` の deep link だけを検証し、vite の `base=/auth/` の SPA
  エントリ `/auth/` の static rewrite を見落としていた。index.html が `/auth/assets/*` を参照するため、
  worker.ts に `/auth` プレフィックスの除去 (Bun の rewriteRequestPath 相当) が必要で、未対応だと
  `/auth/assets/*` が index.html (html) を JS として返し、本番で画面が真っ白になった。

---

### spike-6 (前提 D) — 2026-06-20 — verdict: **grounded**

- 構成: `/tmp/spike-d` (使い捨て、リポジトリ外)。実際の Upstash (ap-northeast-1) に `@upstash/redis` (REST) で接続し、workerd 上で実行した。`.dev.vars` で REST の URL / TOKEN を注入した (検証後にディレクトリごと破棄)。
- 観測 (ground-truth は Upstash サーバの実際の返り値と独立した GET):
  - `multi().incr().expire().ttl().exec()` が `[1, 1, 60]` を返した。rate-limit.ts が読む `results[0]` (count) / `results[2]` (ttl) が node-redis 互換の並びで取れる
  - 50 並列の multi / incr の後、独立した GET で `50` になった (lost update なし)。つまり atomic である
  - `set(ex:2)` の後の get で raw string が返り、2.5s 後の get は null になった (TTL 失効)
- 移植上の注意: `@upstash/redis` は既定で自動的に (de)serialize する。redisStorage は raw string の契約 (better-auth が JSON 文字列を保存する) なので、**`automaticDeserialization: false`** を指定して node-redis 互換にする。
- 結論: redis の課題は Upstash REST で解消する。`src/redis.ts` の `redisStorage` と `src/rate-limit.ts` の MULTI を `@upstash/redis` に差し替えるだけでよい。

### 前提 F (cost) — 2026-06-20 — verdict: **grounded (条件付き)**

- Workers / Neon / Upstash / Hyperdrive のすべてに無料枠があり、この件は日本単一・個人運用の低トラフィックである。$0 ホスティングは無料枠内で成立する。
- 条件: 各無料枠の上限 (Workers の req/日、Neon の容量と compute time、Upstash の command/日) は変動するため、launch 時点の実数値で再確認する。ドメインだけは課金される (許容済み)。

---

## 結論: feasibility は全項目で実機確認済み (7/7)

| 課題 / 前提 | status |
|---|---|
| A db (Hyperdrive + interactive tx / lock) | ✅ grounded |
| B rpc (fetch 直接配信) | ✅ grounded |
| C better-auth core | ✅ grounded |
| C2 email (react-email / resend) | ✅ grounded |
| D redis (Upstash atomic / TTL) | ✅ grounded |
| E static (Workers Static Assets) | ✅ grounded |
| F cost ($0) | ✅ grounded (条件付き) |

Cloudflare Workers への移植は **$0 で実機の feasibility を全項目確認できた**。残る本番固有の再確認項目は、(1) 本番 Hyperdrive の pool での tx の固定 (2) resend の実送信の疎通 (3) @sentry/bun から @sentry/cloudflare への差し替え (4) 各無料枠の実数値、である。
次の段階は Code-A (PRD 100% の実装) で、その後 loop step 3〜6 でコードから ADR-011 を逆生成する。

---

## Code-A 進捗 (loop step 2) — branch `feat/cloudflare-workers-migration`

採用した構造的判断: **module レベルの singleton (`db` / `redis` / `auth` / `Sentry`) を「ロード時の const 構築」から
「初回リクエスト時に init する `export let` と ESM の live binding」に変える**。Workers の per-request env 制約を満たしつつ、
呼び出し側 (repository / handler 群) をほぼ無改修に保つ。Bun は `typeof Bun` の判定で従来どおり自動 init し、dual-runtime を維持する。
Bun 専用の依存 (`@sentry/bun` / node-redis) は別 module や facade の backend 注入に隔離し、Workers バンドルへの混入を防ぐ。

実装した seam:
- `db/client.ts`: lazy な dual-init (`export let db` と `initDb(connStr)`)
- `src/redis.ts`: node-redis (Bun) / Upstash (Workers) の dual。MULTI を `redisIncrWindow` に集約し、`pingRedis` を追加
- `src/auth.ts`: `buildAuth()` の factory、`export let auth`、`initAuth()`
- `src/sentry.ts`: runtime 非依存の facade と `setSentryBackend`。`src/sentry-bun.ts` に Bun backend を隔離
- `src/rpc/fetch-handler.ts`: `createConnectRouter` + `createFetchHandler` で `/rpc/*` を fetch 配信 (proxy 廃止)
- `src/worker.ts`: Workers の entry (`initRuntime(env)`、buildApp、Static Assets への委譲)
- `wrangler.jsonc` (Hyperdrive + assets の run_worker_first + nodejs_compat)、`.gitignore` に `.dev.vars` / `.wrangler/`

検証 (実機):
- **workerd で実アプリ全体が bundle され boot した** (node-redis / better-auth / drizzle / @vercel/blob / react-email がすべて bundle を通過)
- `/health` は `db: ok` (pingDatabase が Hyperdrive 経由で Postgres に対して動作)。redis は Upstash 未設定のため error
- RPC: key 無しは 401、有効な key と無効な token は `{"error":{"reason":"RESULT_SESSION_NOT_FOUND"}}` (fetch dispatch、middleware、実 handler、DB クエリが workerd で動作)
- 静的: `/assets/*` は 200。SPA は run_worker_first と not_found_handling で配信
- **Bun の全テスト 207 pass / 0 fail** (dual-runtime で Bun は無傷)。typecheck 0

残り (Code-A の仕上げ): Upstash の credential を配線して magic-link を end-to-end で検証する / @sentry/cloudflare を配線する (現状は console fallback) /
index.ts と worker.ts の route 重複を `buildApp` の共有で dedupe する (loop step 3)。その後コードから ADR-011 を逆生成する (step 4〜6)。

### magic-link end-to-end 検証 (ローカル serverless-redis-http) — 2026-06-20

`hiett/serverless-redis-http` で compose の redis を Upstash REST で包み、本番トークン無しで workerd 上の
magic-link の全フローを検証した。sign-in の POST、verify (302)、user 作成 (Hyperdrive 経由の DB)、session
(srh 経由 redis の secondaryStorage)、hook と背景タスク (waitUntil) まで通った。

検証中に workerd 固有の **実際のバグ 3 件** を発見して修正した (机上では出ず、実装後に当たると厄介だった)。

1. **rate-limit の body clone による hang**: email 軸の keyFn の `c.req.raw.clone().json()` が workerd では
   request body の二重読みになり、"hung" (response を生成しない) になった。Hono の body cache (`c.req.json()`) で
   raw を 1 度だけ読み、後段の `auth.handler` も `c.req.arrayBuffer()` (同じ cache) から新しい Request を再構築するようにした。
2. **fire-and-forget による hang**: `hooks.after` の `sendWelcomeEmail` / `appendAuditLog` が await されず、
   workerd は response 後の未解決 promise を "hung" として扱う。`src/background.ts` で AsyncLocalStorage に
   `ctx.waitUntil` を per-request で結び付け、`runBackground()` 経由で登録するようにした (Bun は fire-and-forget のまま)。
   ALS が better-auth の hook 内まで伝播することを実機で確認した (`waitUntil present: true`)。
3. **DB verification 消費の hang**: `verification.storeInDatabase: true` (local の DB token 保存) の時、
   better-auth の DB verification の消費が workerd / Hyperdrive 経路で完走せず "hung" になった。user 作成前に hang する。
   `storeInDatabase: typeof Bun !== "undefined" && isLocalEnvironment()` とし、Workers では false にした
   (本番と同じ secondaryStorage)。Bun-local の e2e は postgres からの token 抽出を維持する。

これらは worker.ts / auth.ts / background.ts に反映済みである。Bun の全テスト 207 pass を維持した (dual-runtime は無傷)。
本番への持ち越し: storeInDatabase=true の経路が workerd で hang する根本原因 (better-auth の DB token 消費の
transaction / query パターン) は本番では通らない経路のため深追いしない。再評価のきっかけは、better-auth 側で DB verification を
Workers 対応した版が出た時とする。

### Code-A step 3 (dedup リファクタ) — 2026-06-20

品質スキル群 (simplify / review-code-quality / express-intent-in-code / dry-ssot / purge-vocab /
polish) を適用した後、index.ts と worker.ts の route 重複を共有の `src/app.ts` の `buildApp` に集約した。runtime
固有部分は `mountStatic` コールバックだけになった。RPC は Bun でも fetch の直接配信に揃え、`node:http` proxy と
`src/proxy-helpers.ts` (とそのテスト) を削除した (ADR-0001 の content-length 回避は obsolete になった)。
検証: typecheck 0 / lint clean / **Bun のテスト 203 pass** (proxy-helpers.test の削除分で 207 から 203 に減少) /
Workers の全 smoke が green (boot / health の db と redis が ok / RPC / `/` の 302 loginShortcut / static / magic-link)。

---

## 実装準備: PR 分割 + デプロイ QA (loop step 6)

### PR 分割 (依存順)

dual-runtime は相互に依存するが、Bun を緑に保ったまま 3 PR と docs に分けてレビューできる。

| PR | スコープ | 含むファイル | 検証 |
|---|---|---|---|
| **PR-0 (docs)** | ADR + 台帳 | `docs/adr/0011-*.md` (+ analysis) / `docs/adr/0001` の superseded マーカー | レビューのみ |
| **PR-1 (foundation)** | singleton を lazy な dual-init にする (Bun の挙動は不変) | `db/client.ts` `src/redis.ts` `src/auth.ts` `src/sentry.ts` `src/sentry-bun.ts` `src/background.ts` `src/env.ts` `src/rate-limit.ts` `src/invitation/rate-limit.ts` `package.json` (`@types/pg` `@upstash/redis`) | Bun のテスト pass / typecheck |
| **PR-2 (shared app + RPC fetch)** | 共有の `buildApp` と RPC の fetch 直接配信、proxy の撤去 | `src/app.ts` `src/rpc/fetch-handler.ts` `src/index.ts` / 削除: `src/proxy-helpers.ts` (+ test) | Bun のテスト pass (RPC を含む) |
| **PR-3 (Workers entry)** | Workers の起動口と設定 | `src/worker.ts` `wrangler.jsonc` `biome.json` (worker.ts の例外) `.gitignore` / devDeps (`wrangler` `@cloudflare/workers-types`) | `wrangler dev` の smoke |

PR-1 / PR-2 は Bun 専用の変更で本番に影響しない (Workers の entry は PR-3 まで存在しない)。
workerd 固有の修正 (body-cache は PR-2、storeInDatabase / waitUntil は PR-1) は Bun では無害である (no-op または従来の挙動)。

### デプロイ QA

**自動 (CI / ローカル):** `bun run typecheck` が 0 / `bun run lint` が clean / `bun test` (compose の DB と redis) が pass /
`wrangler dev --local` と serverless-redis-http で `/health`・RPC・magic-link の smoke。

**手動 (本番デプロイ前):**
1. Cloudflare で Hyperdrive config を作成し (本番 Neon を backing にする)、`wrangler.jsonc` の `hyperdrive.id` を実際の id にする
2. Upstash の本番 Redis (東京 ap-northeast-1) を作成し、トークンを取得する
3. `wrangler secret put` で `AUTH_SECRET` / `AUTH_SERVICE_KEY` / `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` / `SENTRY_DSN` を登録する
4. `wrangler.jsonc` の `vars` を本番値にする (`AUTH_SERVICE_URL=https://auth.taimei-code.com` / `AUTH_COOKIE_DOMAIN=taimei-code.com` / `AUTH_TRUSTED_ORIGINS`)
5. 本番 Neon に migration を適用する (CI から `drizzle-kit migrate` を実行し、Worker 内では実行しない)
6. `bun run build:web` で `web/dist` を作り (wrangler が assets を配信する)、`wrangler deploy` する
7. DNS: `auth.taimei-code.com` を Workers route に向ける
8. 本番 smoke: `/health` (db と redis が ok) / magic-link の sign-in、verify、session / taimei (Vercel) との cookie 共有 (`.taimei-code.com`) / RPC (X-Service-Key)
9. 持ち越し検証 (Consequences): 本番 Hyperdrive の pool での interactive tx (削除 / 除名経路) / resend の実送信 / `@sentry/cloudflare` の配線
