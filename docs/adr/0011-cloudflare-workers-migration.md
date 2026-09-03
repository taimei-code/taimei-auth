# ADR-0011: taimei-auth を Bun / Cloudflare Workers の dual-runtime にする

## Status

Accepted — **本番稼働中** (`auth.taimei-code.com` / Cloudflare Workers + Hyperdrive·Neon + Upstash + Resend)。
実機検証の観測値は
[`0011-cloudflare-workers-migration.analysis.md`](./0011-cloudflare-workers-migration.analysis.md)
(spike 台帳) に記録。本 ADR は決定と理由を担う。デプロイで初めて踏んだバグは「本番デプロイで発見した
workerd 固有 2 点」を参照。

## Context

taimei-auth を $0 でホスティングしたい (taimei 本体は Vercel 据え置き、課金はドメインのみ許容)。
consumer (taimei, `app.taimei-code.com`) との session Cookie 共有は cookie domain `.taimei-code.com`
で発行されるためホストが別でも成立する (ADR-0004) ので、auth を `auth.taimei-code.com` 相当の別ホスト
に置ける。

taimei-auth は Hono を使うが Hono 自体はランタイム非依存で、これは Workers との相性を決める要因では
ない。移植コストは Hono 以外の Bun/Node 依存に集中する: `node:http` で内部 RPC server を立てる proxy、
`pg` (node-postgres) の常駐 pool、`node-redis` の常駐コネクション、`@sentry/bun`。Cloudflare Workers
(workerd) は per-request 実行で、ポートを listen できず TCP 常駐接続も持てない。

実現可能性は机上でなく実機 (`wrangler dev` + 実バックエンド + 独立 ground-truth 照合) で前提を 1 つずつ
接地してから着手を決めた (前提ごとの観測は spike 台帳)。当初最大の賭けだった「DB を Postgres のまま
接続層だけ差し替える」案が Hyperdrive で interactive tx・advisory lock まで含めて通ることを確認できたのが
着手判断の決め手。

## Decision

Bun (compose / テスト / fallback) と Cloudflare Workers (本番) の **dual-runtime** にする。
両 runtime は共有 `src/app.ts` の `buildApp` を使い、entry (`src/index.ts` = Bun、`src/worker.ts`
= Workers) が runtime 固有部分だけを渡す。

### 1. singleton を「ロード時 const」から「初回 init の `export let` + ESM live binding」へ

`db` / `redisStorage` / `auth` / `Sentry` backend を module ロード時に構築すると、Workers の
per-request env (Hyperdrive / Upstash binding は `env` 引数経由でしか来ない) を読めない。そこで:

- `export let db` + `initDb(connStr)` (`db/client.ts`)、`export let auth` + `initAuth()` (`src/auth.ts`) 等にする
- Bun は `isBunRuntime()` (`typeof Bun !== "undefined"`, `src/env.ts`) で module ロード時に自動 init
- Workers は `worker.ts` の `initRuntime(env)` が初回リクエストで `env`→`process.env` 反映 →
  `initDb` → `initRedis` → `initAuth` の順に 1 度だけ init (isolate が warm な間 env 不変)

ESM の live binding により、`import { db }` する repository / handler 群は init 後の値を参照でき、
呼出側はほぼ無改修。

### 2. DB は Postgres 据え置き + Hyperdrive

drizzle の `node-postgres` ドライバを両 runtime で共有する。接続文字列だけが異なる:
Bun は `DATABASE_URL`、Workers は Hyperdrive binding (`env.HYPERDRIVE.connectionString`)。schema /
既存 `drizzle/*.sql` / repository / better-auth `provider:"pg"` は無改修。Hyperdrive を介すことで
`runInTransaction` の interactive tx・`pg_advisory_xact_lock`・`SELECT ... FOR UPDATE` が Workers でも
保たれる (race 直列化が正しさに関わるため必須)。

### 3. Redis は Bun=node-redis / Workers=Upstash REST

`src/redis.ts` が `RedisStorage` (better-auth secondaryStorage) と `incrementRateWindow` (rate-limit
プリミティブ) の interface 越しに 2 実装を init 時に選択する。Upstash REST はコネクションレスで Workers
互換。`@upstash/redis` は `automaticDeserialization: false` で raw string 契約 (better-auth が JSON
文字列を保存) に合わせる。選択は runtime 判定でなく **Upstash 認証情報の有無** で行う。

### 4. RPC は fetch ハンドラ直配信 (connect-node proxy 廃止)

`src/rpc/fetch-handler.ts` が `createConnectRouter` + `createFetchHandler` で `registerRoutes` を
fetch ハンドラとして配信する。`node:http` の内部 server + `/rpc/*` proxy は両 runtime で廃止。
`registerRoutes` と RPC handler は無改修。ADR-0001 の content-length 回避は proxy 消滅で不要になり、
`src/proxy-helpers.ts` ごと削除した。

### 5. 静的配信 = Bun.file / Workers Static Assets

`buildApp` は共有ルートをすべて登録した後、runtime 固有の静的配信を `mountStatic` コールバックで受ける。
Bun は `serveStatic` + `Bun.file` SPA fallback、Workers は `env.ASSETS.fetch` (wrangler `assets` の
`run_worker_first: true` + `not_found_handling: single-page-application`)。worker を常に先に走らせる
ことで `/` の loginShortcut 等が静的 index.html に吸われない。

### 6. 背景タスクは ctx.waitUntil (AsyncLocalStorage 経由)

`src/background.ts` が `AsyncLocalStorage` に `ctx.waitUntil` を per-request 束縛し、`runBackground()`
が `hooks.after` の audit log / welcome email を登録する。Bun では fire-and-forget のまま。

### 7. Sentry は facade + backend 注入

`src/sentry.ts` は SDK 非依存の facade で、entry が backend を注入する (`src/sentry-bun.ts` が
`@sentry/bun`)。handler が import する facade に SDK 依存を持たせないことで Workers バンドルへの
Bun 専用 SDK 混入を防ぐ。Workers は `src/sentry-cloudflare.ts` が `@sentry/cloudflare` backend を
注入し、`worker.ts` の export default を `Sentry.withSentry` でラップする (SENTRY_DSN 未設定時は console fallback)。

### workerd 固有の 3 点 (実機検証で発見・修正)

1. **rate-limit の body clone hang**: `c.req.raw.clone().json()` が workerd で body 二重読みになり
   "hung"。Hono の body cache (`c.req.json()`) で raw を 1 度だけ読み、`auth.handler` も同 cache
   (`arrayBuffer`) から fresh Request を再構築する。
2. **fire-and-forget hang**: await されない promise を workerd は response 後に "hung" 扱いする
   → ctx.waitUntil (上記 6)。
3. **DB verification 消費 hang**: `verification.storeInDatabase: true` の DB token 消費が workerd
   で完走しない → `isBunRuntime() && isLocalEnvironment()` とし Workers では false (本番同様
   secondaryStorage)。Bun-local の e2e は postgres token 抽出を維持。

### 本番デプロイで発見した workerd 固有 2 点

spike で予測しきれず本番 (auth.taimei-code.com) で初めて踏んだ 2 件。

4. **react-email render の lazy CJS init 未実行**: `render` の名前付き import も `import * as ReactEmail`
   の namespace import も、esbuild は同じ未 init 参照 (`render2`) に畳み、workerd で
   `render2 is not a function` になる (magic-link 送信が 500)。`await import("@react-email/components")`
   の dynamic import で実行時に module init を強制して回避 (auth.ts / send-welcome.ts / send-invitation.ts)。
   spike-4 の「namespace import で解決」は最小 spike バンドルでのみ成立し、better-auth 等を含む本実装
   バンドルでは効かなかった。
5. **vite base=/auth/ の static rewrite 欠落**: index.html は `/auth/assets/*` を参照するが、Workers
   Static Assets は web/dist を `/` 直下に配信する。worker.ts の mountStatic で `/auth` を剥がして委譲
   しないと `/auth/assets/*` が実在せず、not_found_handling=single-page-application が index.html (html)
   を JS として返し SPA が SyntaxError で真っ白になる。Bun index.ts の serveStatic rewriteRequestPath
   (/auth → '') と等価の処理が Workers entry に必要だった。spike-5 は /account deep link のみ検証し、
   SPA エントリ /auth/ の rewrite を見落としていた。

## Why

- **live binding で呼出側を無改修に保つ**: 移植の ripple を repository / handler に広げず、init の
  3 singleton と entry に閉じる。Workers の per-request env 制約を満たしつつ Bun も従来動作を保つ。
- **capability で選ぶ (runtime sniff を避ける)**: redis backend は Upstash 認証情報の有無で、
  DB verification は「その runtime で DB token 消費が完走するか」の capability で選ぶ。`storeInDatabase`
  だけは workerd の不具合回避のため `isBunRuntime()` を使うが、これは capability の近似。
- **Postgres 据え置きが正しさを守る**: 削除/除名/orphan cascade は tx の原子性に依存する。D1/Turso/
  Neon-HTTP はこの型の interactive tx を扱えず、書き換えると正しさ経路を作り直す羽目になる。
  Hyperdrive なら接続層の差し替えで済む。

## 検討した代替案 (不採用) と再評価トリガー

| # | 案 | 不採用理由 | 再評価トリガー |
|---|---|---|---|
| A | auth も Vercel | 常駐 RPC proxy + 常駐接続が serverless 非互換。再設計コスト大 | — |
| B | Cloud Run | Dockerfile 無改修で動くが、課金アカウント有効化が必要 + cold start。$0 厳守と Workers の edge 親和性で見送り | Workers 無料枠超過 / Docker 資産を活かしたい時 |
| C | DB を Cloudflare D1 | interactive tx 非対応 (batch のみ)。tx 多用経路を書き換える羽目 | better-auth/アプリが batch tx 設計になった時 |
| D | DB を Turso (libSQL) | interactive tx は可だが pg→sqlite 方言・migration 全書換 | 外部 Postgres 依存を消し完全 edge native にしたい時 (別 ADR) |
| E | DB を Neon HTTP ドライバ | interactive tx 非対応。Hyperdrive/neon-serverless が必要 | — |
| F | rate-limit を Cloudflare KV | 結果整合でカウンタがずれる。atomic INCR 不可 | 強整合が要らない用途のみ |
| G | Bun を捨て Workers 専用 | テスト/compose/fallback を失う。dual の方が安全 | Workers 運用が安定し Bun 維持コストが上回った時 |
| H | DB を Cloudflare ネイティブ Postgres | 2026-06 時点で非存在。Cloudflare の Postgres 窓口は Hyperdrive (接続層) と PlanetScale 提携 ($5/月〜・無料枠なし) のみ。D1 は SQLite。$0 を破るうえ接続層は結局 Hyperdrive で Neon と同じ | Cloudflare が無料枠付きの自社 Postgres を出した時 (blog.cloudflare.com の tag/postgres を監視) |

## Consequences

- **dual-runtime の維持コスト**: 2 runtime 分の init 経路と backend 実装を持つ。代わりに Bun fallback
  (compose / テスト / Cloud Run 退避路) を保持できる。実装時の検証では Bun テスト suite 全 pass・
  Workers の boot/health/RPC/magic-link を実機確認した (観測は analysis.md)。
- **移植に伴う付随変更**: `@types/pg` 追加 (pg を直 import するようになったため)。rate-limit 2 本
  (`src/rate-limit.ts` / `src/invitation/rate-limit.ts`) は backend 直叩きから `incrementRateWindow`
  interface 経由に。`AUTH_SERVICE_KEY` の production 未設定 fail-fast は entry 起動時の `process.exit`
  (`src/index.ts`) と `/rpc/*` の 503 (`src/app.ts`) の 2 段。`.gitignore` に `.dev.vars` /
  `.wrangler/` を追加 (dev secret と wrangler 一時物の除外)。
- **本番固有の未確認/未了**: (1) 本番 Hyperdrive pool での tx pinning = `pg_advisory_xact_lock` +
  `SELECT FOR UPDATE` の 2 並列 tx が直列化することを本番 remote Hyperdrive で実機確認し**完了**
  (lost update なし、`A:enter,A:exit,B:enter,B:exit`)。(2) resend 実送信疎通 = Resend で
  `transactional.taimei-code.com` 検証 + `AUTH_FROM_EMAIL_*` 設定で**完了**。(3) `@sentry/cloudflare`
  配線 = `Sentry.withSentry` + backend 注入で**完了** (SENTRY_DSN 設定で有効化)。残: (4) 各無料枠の
  実数値 (Neon 0.5GB/100 compute-h 等、launch 後の実トラフィックで再確認)。
- **`storeInDatabase` の根因は未追跡**: workerd で DB verification 消費が hang する根因 (better-auth
  の DB token 消費の tx/query パターン) は本番非経路のため深追いせず。再評価トリガー = better-auth が
  Workers 対応の DB verification 版を出した時。
- **$0 は無料枠内で成立**: Workers / Neon / Upstash / Hyperdrive。日本単一・個人運用の低トラフィック
  前提で、launch 時に各枠の実数値を再確認する。
- **Upstash free tier の無活動アーカイブ**: 30 日間データ操作 (PING 不算入) が無いと DB がアーカイブされ
  REST endpoint が消える。session / verification は Redis のみに置くため、その時点で magic link 送信が
  500 になる (2026-09-03 に本番で発生。`/health` の `redis: error` と `wrangler tail` の
  `UpstashJSONParseError ... error code: 1016` が目印)。対策は Cron Trigger (`wrangler.jsonc`
  `triggers.crons`) から `src/worker.ts` の `scheduled` が毎日 TTL 付き SET を打つ keep-alive
  (`src/redis-keepalive.ts`)。復旧は Upstash Console で DB を復元/再作成し `wrangler secret put` で
  `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` を更新する。
- **Hyperdrive の query caching は無効にする**: Hyperdrive は既定で parameterized な SELECT の結果を
  max_age 60s / stale-while-revalidate 15s で cache する (tx 内の読み取りと mutation は対象外)。本 service
  の membership 読み取り (`findMembershipsByUserId`) は cacheable なので、signup → 事業所作成 → `/account`
  の直後に `/api/account/memberships` が作成前の空結果を返し、SessionGuard が `/auth/signup/company` へ
  戻す (2026-09-03 に本番で再現。約 60s 後に正しく 1 件返る)。認証 / membership の読み取りは stale を
  許容できないため、本番 config は `wrangler hyperdrive update <id> --caching-disabled` で cache を切り、
  `wrangler hyperdrive get <id>` の `caching.disabled: true` を確認する (analysis.md の spike-1 で
  「本番 query caching の再確認」として持ち越していた項目の結論)。config を作り直す時は
  `--caching-disabled` を付ける。回帰確認は QA-MR-10。
- **本番 secret/設定**: `wrangler secret put` で `AUTH_SECRET` / `AUTH_SERVICE_KEY` / `UPSTASH_*` /
  `SENTRY_DSN` を注入。`hyperdrive.id` を実 config に、`vars` を本番値にする。DNS で `auth` subdomain
  を Workers に向ける。migration は CI から drizzle-kit で流す (Worker 内では実行しない)。

## Sources / Related

- 実機検証の観測値・ground-truth: [`0011-cloudflare-workers-migration.analysis.md`](./0011-cloudflare-workers-migration.analysis.md)
- ADR-0001 (RPC proxy content-length) — 本 ADR で proxy 廃止により obsolete
- ADR-0002 (SPA routing) / ADR-0004 (cross-subdomain cookie) — 静的配信・Cookie 前提
