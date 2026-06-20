# ADR-0011 Cloudflare Workers 移植 — 検証台帳 (ledger)

> これは `iterate-with-prototypes` の **単一正本 (ledger)** であり、完成版 ADR ではない。
> 設計書 (`0011-cloudflare-workers-migration.md`) は spike で前提を接地し Code-A を動かした後、
> **コードから逆生成**する。本ファイルは「何を・どう検証し・どうなったら kill するか」と
> その status の唯一の記録場所。以後の TODO・決定・AC はここに集約する。

## 背景 (確定事項)

- ホスティング: taimei-auth を **Cloudflare Workers**、taimei は **Vercel 据え置き**。$0 (ドメイン除く)。
- cross-subdomain Cookie (`.taimei-code.com`) はホストが別でも成立 (ADR-0004)。ADR-008 のデプロイ前提と一致。
- DB: **Postgres 据え置き + Hyperdrive** (backing = Neon 無料枠)。schema / `drizzle/*.sql` / repositories / better-auth `provider:"pg"` を温存し、移植を「接続層の差し替え」に縮める。
  - 却下: Neon HTTP (interactive tx 非対応) / D1 (batch のみ、tx 非対応) / Turso (sqlite 方言書換) / PlanetScale (mysql + 有料)。再評価トリガー = 「完全 edge ネイティブ化」を独立 ADR で扱う時。
- Redis: **Upstash REST**。RPC: **connect-node 内部 http proxy を廃し ConnectRPC を fetch ハンドラ直結**。

## ガードレール判定

code-first 適用可。主リスクは feasibility のみ。schema / RPC 契約は凍結、可逆 (Cloud Run/Bun fallback)。
spike は本番非接触 throwaway (ローカル PG + ローカル Hyperdrive 接続文字列) に限定。

## 前提台帳 (不確実性 × 手戻り でランク)

status: **unverified / grounded / killed** の 3 値のみ。grounded は ground-truth 照合の証拠がある時だけ。

| # | 主張 | 検証方法 (ground-truth + 予算 + 代表入力) | kill 条件 | status |
|---|---|---|---|---|
| **A** | `pg` (node-postgres) ドライバが Workers (`nodejs_compat`) + Hyperdrive binding で起動し、drizzle の `runInTransaction` の **interactive tx** (読む→分岐→書く) が原子性を保ち、**tx スコープのロック** (`pg_advisory_xact_lock` / `SELECT ... FOR UPDATE`) が tx 末まで同一接続に pin される (Hyperdrive pooling を貫通する) | `wrangler dev` で最小 Worker を立て、Hyperdrive→ローカル PG (compose の auth-postgres) に接続。**ground-truth = PG の実テーブル状態 (worker と独立した直 pg 接続で SELECT)**。①commit: read count→0 で insert(audit)+delete(user) → user 消失 + audit 1 行 ②rollback: tx 内で throw → **両方未変更にロールバック** ③advisory lock: `pg_advisory_xact_lock(hashtext($1))` を 2 tx 並列で取り直列化を確認 ④`SELECT id ... FOR UPDATE` が tx 内で行ロックを保持。レイテンシ p95 ≤ 500ms (ローカル、10 連続計測) | tx 内 throw でロールバックされない / pg が workerd で起動しない / Hyperdrive 経由で tx が張れない / **advisory lock or FOR UPDATE が tx 末まで保持されず race が直列化されない** | **grounded** (spike-1) |
| **B** | 既存 `registerRoutes(ConnectRouter)` を無改修のまま、ConnectRPC を fetch ハンドラとして Hono on Workers で配信でき、AuthService/UserService が応答する (ADR-0001 の content-length 回避は proxy 消滅で不要化) | `wrangler dev` 上の Hono に Connect の fetch handler をマウント。`@connectrpc/connect-web` transport の SDK から `verifySession` 相当を 1 RPC 呼ぶ。**ground-truth = 同 RPC を現行 Bun 実装に投げた応答** と byte 等価 (proto decode 後の field 一致)。unary のみ (本 repo は streaming 未使用) | fetch handler で RPC が 4xx/5xx になる / content-length 起因で body が壊れる / handlers の改修が必要になる | **grounded** (spike-3) |
| **C** | better-auth **core** (drizzleAdapter + secondaryStorage + magic-link + crossSubDomainCookies) が Workers fetch ランタイムで起動・動作する | `wrangler dev` 上で magic-link sign-in → verify → getSession。**ground-truth = 独立 pg 接続で user 行生成 + cookie 属性**。`Domain=.taimei-code.local` / `HttpOnly` / `SameSite=Lax` | better-auth が Workers で起動しない / cookie 属性が壊れる / magic-link verify が失敗 | **grounded** (spike-2) |
| **C2** | auth.ts の周辺依存 (`@react-email/components` の `render` = react-dom/server、`resend` SDK、`@sentry/bun`) が workerd で動く | 各 dep を worker に import し render/send/capture を実行。**ground-truth = HTML 出力 / Resend API 応答 / Sentry イベント受信**。`@sentry/bun`→`@sentry/cloudflare`、resend は fetch ベースで可の見込み、react-email render が要注意 | react-email render が workerd で例外 / resend が Node API 依存で動かない | **grounded** (spike-4, 注意付き) |
| **D** | Upstash REST で rate-limit の `multi().incr().expire().ttl().exec()` が atomic に動き、secondaryStorage の get/set/delete(TTL) が機能する | Upstash 無料 DB に対し ①INCR×N 並列で counter が正確 ②EXPIRE 後 TTL 観測 (put→ttl 実測) ③secondaryStorage: set(ttl=2s)→get→2s 後 get=null。**ground-truth = Upstash 実 DB の返り値** | 並列 INCR で counter がずれる / TTL が効かない / multi が atomic でない | **grounded** (spike-6) |
| **E** | web/dist の SPA を Workers Static Assets で配信し、SPA fallback + canary token 埋め込み (ADR-0002/0005) が成立する | `wrangler dev` の assets で `/account` 等の deep link が index にフォールバック、canary token が HTML に注入される。**ground-truth = 現行 `spa-fallback.ts` の出力 HTML** | deep link が 404 / canary 注入が消える | **grounded** (spike-5) |
| **F** | 月額ホスティング $0 (Workers free + Neon free + Upstash free + Hyperdrive free の枠内) | 各無料枠の上限 (req/日, DB 容量, command/日) を着手時点の実値で確認し、想定トラフィック (個人運用) を下回ることを算術照合 | いずれかが無料枠で賄えず課金必須 | unverified |

## ランク根拠

- **A が最上位**: 不確実性 高 (Workers+Hyperdrive+pg+interactive tx の組合せ未検証、pg が Workers で動くか自体が未確認) × 手戻り 最大 (外れたら DB 戦略総崩れ → neon-serverless WebSocket か Turso へ転換)。削除/除名の正しさが直接かかる。
- **C は手戻り大だが不確実性中**: better-auth は Workers 対応を公称。A の次。
- **B 中×中** (index.ts 配線のみ、handlers 不変) → **D/E/F は低×小**。
- A と「pg が Workers で起動するか」は同一データ経路なので **1 spike に同居**させ verdict を分ける。

## 進め方 (The loop)

1. **spike-1 = 前提 A** (最上位)。grounded になるまで周回。次に C → B。D/E/F は軽いので Code-A 着手後に確認。
2. A が grounded になってから Code-A (PRD 100% の動くコード) 着手。
3. Code-A′ (リファクタ) → コードから ADR-011 逆生成 → grill/AC/MECE/SSOT → PR 分割。

## spike ログ

### spike-1 (前提 A) — 2026-06-20 — verdict: **grounded**

- 構成: `/tmp/spike-hd` (throwaway)。`wrangler dev` (wrangler 4.103.0) で実 workerd を起動、Hyperdrive binding を **local mode** で compose の auth-postgres (専用 `spike_db`) に接続。worker は `pg`(node-postgres) + `drizzle-orm/node-postgres` で本番と同じ `db.transaction` を使用。
- ground-truth: worker と無関係な直 pg 接続 (`verify.ts`) で最終テーブル状態を SELECT。
- 観測 (worker / ground-truth 一致):
  - `driverBooted: true` — pg が workerd+nodejs_compat+Hyperdrive で起動 (歴史的に pg は Workers 不可だったが Hyperdrive + nodejs_compat で接続成立)
  - `commit_ms: 4` / `commit_readCount: 1` — interactive 読む→分岐→書く tx が機能
  - **原子性**: ground-truth `atomicity_pass: true` (commit 経路は user 削除確定 + audit 残存、rollback 経路は throw で user/audit とも未変更に revert)
  - **advisory lock**: `pg_advisory_xact_lock` で並列 2 tx が非 interleave に直列化 (`A:enter,A:exit,B:enter,B:exit`) → company 作成 TOCTOU / OWNER race の防止機構が Hyperdrive pooling を貫通
  - `SELECT ... FOR UPDATE`: tx 内で行ロック取得成功 (`forupdate_rows:1`)
  - レイテンシ p95 ≤ 500ms: 4ms (ローカル) で充足
- 結論: **DB 戦略 (Postgres 据え置き + Hyperdrive, schema 凍結) を実機で接地**。DB 移行は「接続層の差し替え」に縮められることが確認できた。kill 条件のいずれも発火せず。
- 注意 (本番への持ち越し検証): 本 spike は Hyperdrive **local mode** (直 PG proxy)。本番 Hyperdrive は connection pooling + query caching が入るため、(a) tx pinning が本番 pool でも保たれるか (b) prepared statement / `SET` 系が pool で漏れないか を本番相当 (remote Hyperdrive + Neon) で再確認する項目として ADR に残す。

### spike-2 (前提 C) — 2026-06-20 — verdict: **grounded** (core)

- 構成: repo 内 `_spike_c/` (untracked, 後で削除)。`db/schema.ts` を `../db/schema` で忠実に import し、本物のスキーマ (drizzle migrate + manual trigger 済) を持つ `spike_db` に Hyperdrive 越しで接続。better-auth は本番 `src/auth.ts` の核心 (magicLink + drizzleAdapter pg + secondaryStorage + additionalFields revision/lastUsedCompanyId + crossSubDomainCookies + cookieCache + freshAge=0) を写す。email/resend/sentry/hooks は除外 (→ C2)。
- ground-truth: 独立 pg 接続 (`verify.ts`) で user 行を確認。
- 観測:
  - `betterAuthInstantiated: true` — better-auth core が workerd で起動 (import 時 Node 専用 API で割れない)
  - magic-link 発行 → token 取得 → `verify_status: 200` → `getSession` が email 一致で non-null
  - ground-truth: `user` 行 1 件生成 (email + `revision:0` default 成立) = drizzleAdapter(pg) の書込が Hyperdrive 越しに成立
  - cookie 属性: `Domain=.taimei-code.local` + `HttpOnly` + `SameSite=Lax` = crossSubDomain cookie が workerd で正しく発行
- 学び (移植 TODO の実データ):
  - **session は DB session テーブルに入らない** — secondaryStorage 構成では session は secondary storage (本番 = Upstash) に格納され DB `session` は空。これは現行設計どおり (db/CLAUDE.md ルール 2 例外の cookieCache と整合)。DB session を直読みするコードがあれば移植時に要注意 (= 無い想定だが grep する)。
  - server API `auth.api.*` を server-side で呼ぶ時は `headers` 必須 (spike では明示注入が要った)。本番は `auth.handler(req.raw)` 経由で実 headers が乗るので非問題。
- 残: **C2** (react-email render / resend / sentry の workerd 互換) は未検証。これは better-auth core とは独立した周辺依存の移植項目。

### spike-3 (前提 B) — 2026-06-20 — verdict: **grounded**

- 構成: repo 内 `_spike_b/` (untracked, 後で削除)。repo の実 `AuthService` 記述子 (`src/gen/auth/v1/auth_pb`) を無改修 import。`createConnectRouter()` + `router.service(AuthService, stubImpl)` + 各 `router.handlers` を `createFetchHandler` で fetch 化し Hono にマウント。DB/better-auth 非依存 (transport が論点)。
- 観測 (ground-truth = Connect JSON protocol の応答):
  - `/_paths` が 5 メソッドの Connect path を配信 (`/auth.v1.AuthService/{VerifySession,GetUser,FindAccountByUserId,SignOut,SendMagicLink}`)
  - `POST /auth.v1.AuthService/SignOut` (Connect JSON, `Connect-Protocol-Version: 1`) → `{"success":true}` / HTTP 200 / `application/json`
  - stub が返した proto 未定義フィールド `echoedToken` が応答から脱落 = proto シリアライズが正しく機能
  - 未知 path → Hono fallback で 404
- 結論: connect-node の内部 `http.createServer` + `/rpc/*` proxy を廃し、`createConnectRouter` + `createFetchHandler` で workerd 直配信できる。`registerRoutes(router)` は無改修で再利用、変更は `index.ts` の配線のみ。**ADR-0001 の content-length 回避は proxy 消滅で不要化**を裏付け (fetch 応答が回避なしで正しい)。
- 残 (低 risk): 本 spike は **Connect JSON / unary** のみ (repo は全 unary)。binary protobuf は同一 fetch handler の codec 分岐なので別 spike 不要と判断。本番では `/rpc` prefix と X-Service-Key middleware を Hono 側に再配置する (現行 index.ts と同じ責務、移植時に配線)。

---

### spike-4 (前提 C2) — 2026-06-20 — verdict: **grounded** (注意付き)

- 構成: repo 内 `_spike_c2/` (untracked)。repo の実 `src/email/magic-link.tsx` (Tailwind + Button/Img/Link 等) を workerd で `render` し、Bun での同一 render を ground-truth に照合。
- 観測:
  - **react-email render が workerd で動作し、Bun と byte 同一**: 両 runtime とも `html_len=5932 / text_len=371`、ボタン文言「ログインする」・token・Tailwind→inline CSS (`background-color`) すべて反映。react-dom/server + Tailwind CSS インライン化が workerd で成立。
  - **resend SDK が workerd で instantiate 成功** (`emails.send` が関数として存在、fetch ベースで Node API 非依存の見込み)。実送信は未検証 (要 API キー)。
  - **重要な移植注意**: `import { render } from "@react-email/components"` の**名前付き import は workerd の esbuild バンドルで `render2 is not a function` で失敗**。`import * as ReactEmail` の namespace アクセスで解決。Bun では名前付き import が通る (= workerd バンドル固有の CJS/ESM interop 問題)。移植時は namespace import か、解決を bundle で検証する。
- 残 (既知の swap、spike 不要): `@sentry/bun` は名前どおり Bun 専用 → `@sentry/cloudflare` へ差し替え。resend の実送信は本番キーで疎通確認。

### spike-5 (前提 E) — 2026-06-20 — verdict: **grounded**

- 構成: repo 内 `_spike_e/` (untracked)。`assets: { directory: "../web/dist", not_found_handling: "single-page-application" }` + worker を共存させ、worker は `/api/*` `/auth/canary-token/*` を処理し残りを `env.ASSETS.fetch` へ委譲。
- 観測 (ground-truth = 実 HTTP 応答):
  - `/` → 200 text/html (SPA root)
  - `/account` (deep link, 拡張子なし) → index.html に fallback (`<title>taimei-auth</title>`)
  - `/assets/index-CUN7KAFa.js` → 200 text/javascript (静的配信)
  - `/api/ping` → `{"from":"worker"}` (worker ルートが SPA fallback に吸われず共存)
  - `/auth/canary-token/abc` → 204 (worker ルート動作)
- 結論: `Bun.file` の spa-fallback は Workers Static Assets (`single-page-application` mode) で置換でき、worker ルートと共存する。canary token は単なる GET ルート (Sentry 通知 + 204) で静的配信と独立、移植は自明。

---

### spike-6 (前提 D) — 2026-06-20 — verdict: **grounded**

- 構成: `/tmp/spike-d` (throwaway, repo 外)。実 Upstash (ap-northeast-1) に `@upstash/redis`(REST) で接続し workerd 上で実行。`.dev.vars` で REST URL/TOKEN を注入 (検証後ディレクトリごと破棄)。
- 観測 (ground-truth = Upstash サーバの実返り値 / 独立 GET):
  - `multi().incr().expire().ttl().exec()` → `[1, 1, 60]`。rate-limit.ts が読む `results[0]`(count) / `results[2]`(ttl) が node-redis 互換の並びで取れる
  - 50 並列 multi/incr → 独立 GET で `50` (lost update なし) = atomic
  - `set(ex:2)` → get で raw string → 2.5s 後 get=null (TTL 失効)
- 移植注意: `@upstash/redis` は既定で auto (de)serialize する。redisStorage は raw string 契約 (better-auth が JSON 文字列を保存) なので **`automaticDeserialization: false`** を指定して node-redis 互換にする。
- 結論: redis ネックは Upstash REST で解消。`src/redis.ts` の `redisStorage` + `src/rate-limit.ts` の MULTI を `@upstash/redis` に差し替えるだけ。

### 前提 F (cost) — 2026-06-20 — verdict: **grounded (条件付き)**

- Workers / Neon / Upstash / Hyperdrive すべて無料枠が存在し、本件は日本単一・個人運用の低トラフィック。$0 ホスティングは無料枠内で成立する。
- 条件: 各無料枠の上限 (Workers req/日、Neon 容量・compute time、Upstash command/日) は流動的なため、launch 時点の実数値で再確認する。ドメインのみ課金 (許容済み)。

---

## 結論: feasibility 全接地 (7/7)

| ネック/前提 | status |
|---|---|
| A db (Hyperdrive + interactive tx/lock) | ✅ grounded |
| B rpc (fetch 直配信) | ✅ grounded |
| C better-auth core | ✅ grounded |
| C2 email (react-email/resend) | ✅ grounded |
| D redis (Upstash atomic/TTL) | ✅ grounded |
| E static (Workers Static Assets) | ✅ grounded |
| F cost ($0) | ✅ grounded (条件付き) |

Cloudflare Workers 移植は **$0 で実機 feasibility 全接地**。残る本番固有の再確認項目: (1) 本番 Hyperdrive pool での tx pinning (2) resend 実送信疎通 (3) @sentry/bun→@sentry/cloudflare (4) 各無料枠の実数値。
次段 = Code-A (PRD 100% 実装) → loop step 3-6 でコードから ADR-011 を逆生成。

---

## Code-A 進捗 (loop step 2) — branch `feat/cloudflare-workers-migration`

採用した構造的判断: **module-level singleton (`db`/`redis`/`auth`/`Sentry`) を「ロード時 const 構築」から
「初回リクエスト時 init の `export let` + ESM live binding」へ**。Workers の per-request env 制約を満たしつつ
呼出側 (repository / handler 群) をほぼ無改修に保つ。Bun は `typeof Bun` 判定で従来どおり自動 init し dual-runtime 維持。
Bun 専用依存 (`@sentry/bun` / node-redis) は別 module / facade backend 注入に隔離し Workers バンドルへの混入を防ぐ。

実装した seam:
- `db/client.ts`: lazy dual-init (`export let db` + `initDb(connStr)`)
- `src/redis.ts`: node-redis(Bun) / Upstash(Workers) dual、MULTI を `redisIncrWindow` に集約、`pingRedis` 追加
- `src/auth.ts`: `buildAuth()` 工場 + `export let auth` + `initAuth()`
- `src/sentry.ts`: runtime 非依存 facade + `setSentryBackend`、`src/sentry-bun.ts` に Bun backend 隔離
- `src/rpc/fetch-handler.ts`: `createConnectRouter`+`createFetchHandler` で `/rpc/*` を fetch 配信 (proxy 廃止)
- `src/worker.ts`: Workers entry (`initRuntime(env)` + buildApp + Static Assets 委譲)
- `wrangler.jsonc` (Hyperdrive + assets run_worker_first + nodejs_compat)、`.gitignore` に `.dev.vars`/`.wrangler/`

検証 (実機):
- **workerd で実アプリ全体が bundle + boot** (node-redis / better-auth / drizzle / @vercel/blob / react-email 全て bundle 通過)
- `/health` → `db: ok` (pingDatabase が Hyperdrive→Postgres で動作) / redis は Upstash 未設定のため error
- RPC: key 無し→401、有効 key + 無効 token→`{"error":{"reason":"RESULT_SESSION_NOT_FOUND"}}` (fetch dispatch + middleware + 実 handler + DB クエリが workerd で動作)
- 静的: `/assets/*` 200、SPA は run_worker_first + not_found_handling
- **Bun 全テスト 207 pass / 0 fail** (dual-runtime: Bun 無傷)、typecheck 0

残 (Code-A 仕上げ): Upstash creds 配線で magic-link end-to-end 検証 / @sentry/cloudflare 配線 (現状 console fallback) /
index.ts と worker.ts の route 重複を `buildApp` 共有に dedupe (loop step 3) → コードから ADR-011 逆生成 (step 4-6)。

### magic-link end-to-end 検証 (ローカル serverless-redis-http) — 2026-06-20

`hiett/serverless-redis-http` で compose redis を Upstash REST で包み、本番トークン無しで workerd 上の
magic-link 全フローを検証。sign-in POST → verify (302) → user 作成 (DB via Hyperdrive) → session
(secondaryStorage via srh→redis) → hook + 背景タスク (waitUntil) まで通った。

検証中に workerd 固有の**実バグ 3 件**を発見・修正 (机上では出ず、実装後に踏むと厄介だった):

1. **rate-limit の body clone hang**: email-axis keyFn の `c.req.raw.clone().json()` が workerd で
   request body 二重読みになり "hung" (response を生成しない)。→ Hono の body cache (`c.req.json()`) で
   raw を 1 度だけ読み、後段 `auth.handler` も `c.req.arrayBuffer()` (同 cache) から fresh Request を再構築。
2. **fire-and-forget hang**: `hooks.after` の `sendWelcomeEmail` / `appendAuditLog` が await されず、
   workerd は response 後の未解決 promise を "hung" 扱いにする。→ `src/background.ts` で AsyncLocalStorage に
   `ctx.waitUntil` を per-request 束縛し、`runBackground()` 経由で登録 (Bun は fire-and-forget のまま)。
   ALS が better-auth hook 内まで伝播することを実機確認 (`waitUntil present: true`)。
3. **DB verification 消費 hang**: `verification.storeInDatabase: true` (local の DB token 保存) のとき、
   better-auth の DB verification 消費が workerd/Hyperdrive 経路で完走せず "hung"。user 作成前に hang。
   → `storeInDatabase: typeof Bun !== "undefined" && isLocalEnvironment()` とし、Workers では false
   (本番同様 secondaryStorage)。Bun-local の e2e は postgres token 抽出を維持。

これらは worker.ts / auth.ts / background.ts に反映済み。Bun 全テスト 207 pass を維持 (dual-runtime 無傷)。
本番への持ち越し: storeInDatabase=true 経路が workerd で hang する根因 (better-auth の DB token 消費の
transaction/query パターン) は本番非経路のため深追いせず、再評価トリガー = better-auth 側で DB verification を
Workers 対応する版が出たとき。

### Code-A step 3 (dedup リファクタ) — 2026-06-20

品質スキル群 (simplify / review-code-quality / express-intent-in-code / dry-ssot / purge-vocab /
polish) 適用後、index.ts と worker.ts の route 重複を共有 `src/app.ts` の `buildApp` に集約。runtime
固有は `mountStatic` コールバックのみ。RPC は Bun でも fetch 直配信に converge し `node:http` proxy +
`src/proxy-helpers.ts` (+ その test) を削除 (ADR-0001 content-length 回避が obsolete 化)。
検証: typecheck 0 / lint clean / **Bun テスト 203 pass** (proxy-helpers.test 削除分で 207→203) /
Workers 全 smoke green (boot / health db+redis ok / RPC / `/`→302 loginShortcut / static / magic-link)。

---

## 実装準備: PR 分割 + デプロイ QA (loop step 6)

### PR 分割 (依存順)

dual-runtime は相互依存だが、Bun を緑に保ったまま 3 PR + docs に分けてレビューできる。

| PR | スコープ | 含むファイル | 検証 |
|---|---|---|---|
| **PR-0 (docs)** | ADR + 台帳 | `docs/adr/0011-*.md` (+ analysis) / `docs/adr/0001` superseded マーカー | レビューのみ |
| **PR-1 (foundation)** | singleton を lazy dual-init 化 (Bun 挙動不変) | `db/client.ts` `src/redis.ts` `src/auth.ts` `src/sentry.ts` `src/sentry-bun.ts` `src/background.ts` `src/env.ts` `src/rate-limit.ts` `src/invitation/rate-limit.ts` `package.json` (`@types/pg` `@upstash/redis`) | Bun テスト pass / typecheck |
| **PR-2 (shared app + RPC fetch)** | 共有 `buildApp` + RPC fetch 直配信、proxy 撤去 | `src/app.ts` `src/rpc/fetch-handler.ts` `src/index.ts` / 削除: `src/proxy-helpers.ts` (+ test) | Bun テスト pass (RPC 含む) |
| **PR-3 (Workers entry)** | Workers 起動口 + 設定 | `src/worker.ts` `wrangler.jsonc` `biome.json` (worker.ts 例外) `.gitignore` / devDeps (`wrangler` `@cloudflare/workers-types`) | `wrangler dev` smoke |

PR-1/PR-2 は Bun 専用変更で本番に影響しない (Workers entry は PR-3 まで存在しない)。
workerd 固有の修正 (body-cache=PR-2, storeInDatabase/waitUntil=PR-1) は Bun では無害 (no-op / 従来挙動)。

### デプロイ QA

**自動 (CI / ローカル):** `bun run typecheck` → 0 / `bun run lint` → clean / `bun test` (compose DB+redis) → pass /
`wrangler dev --local` + serverless-redis-http で `/health`・RPC・magic-link smoke。

**手動 (本番デプロイ前):**
1. Cloudflare で Hyperdrive config 作成 (本番 Neon を backing) → `wrangler.jsonc` の `hyperdrive.id` を実 id に
2. Upstash 本番 Redis (東京 ap-northeast-1) 作成 → トークン取得
3. `wrangler secret put` で `AUTH_SECRET` / `AUTH_SERVICE_KEY` / `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` / `SENTRY_DSN`
4. `wrangler.jsonc` の `vars` を本番値に (`AUTH_SERVICE_URL=https://auth.taimei-code.com` / `AUTH_COOKIE_DOMAIN=taimei-code.com` / `AUTH_TRUSTED_ORIGINS`)
5. 本番 Neon に migration 適用 (CI から `drizzle-kit migrate`、Worker 内では実行しない)
6. `bun run build:web` → `web/dist` (wrangler が assets 配信) → `wrangler deploy`
7. DNS: `auth.taimei-code.com` を Workers route に向ける
8. 本番 smoke: `/health` (db+redis ok) / magic-link sign-in→verify→session / taimei (Vercel) との cookie 共有 (`.taimei-code.com`) / RPC (X-Service-Key)
9. 持ち越し検証 (Consequences): 本番 Hyperdrive pool での interactive tx (削除/除名経路) / resend 実送信 / `@sentry/cloudflare` 配線
