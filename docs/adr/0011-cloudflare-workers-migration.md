# ADR-0011: taimei-auth を Bun / Cloudflare Workers の dual-runtime にする

## Status

Accepted。**本番稼働中** である (`auth.taimei-code.com` / Cloudflare Workers + Durable Objects + Hyperdrive·Neon + Resend)。
Decision 3 (Redis の 2 実装) と Consequences の Upstash の項は [ADR-0019](./0019-ttl-store-durable-objects.md) (2026-09-20) が supersede した (Redis は撤去済み)。
実機検証の観測値は
[`0011-cloudflare-workers-migration.analysis.md`](./0011-cloudflare-workers-migration.analysis.md)
(spike 台帳) に記録している。この ADR は決定と理由を担う。デプロイで初めて当たったバグは「本番デプロイで発見した
workerd 固有 2 点」を参照。

## Context

taimei-auth を $0 でホスティングしたい (taimei 本体は Vercel のままで、課金はドメインだけ許容する)。
consumer (taimei、`app.taimei-code.com`) との session Cookie の共有は、cookie domain `.taimei-code.com`
で発行されるためホストが別でも成立する (ADR-0004)。そのため auth を `auth.taimei-code.com` 相当の別ホスト
に置ける。

taimei-auth は Hono を使うが、Hono 自体はランタイムに依存せず、Workers との相性を決める要因では
ない。移植コストは Hono 以外の Bun / Node 依存に集中する: `node:http` で内部 RPC server を立てる proxy、
`pg` (node-postgres) の常駐 pool、`node-redis` の常駐コネクション、`@sentry/bun` である。Cloudflare Workers
(workerd) は per-request 実行で、ポートを listen できず、TCP の常駐接続も持てない。

実現可能性は机上ではなく実機 (`wrangler dev` と実バックエンド、独立した ground-truth との照合) で前提を 1 つずつ
確かめてから着手を決めた (前提ごとの観測は spike 台帳)。当初最大の賭けだった「DB を Postgres のまま
接続層だけ差し替える」案が、Hyperdrive で interactive tx と advisory lock まで含めて通ることを確認できたのが
着手判断の決め手である。

## Decision

Bun (compose / テスト / fallback) と Cloudflare Workers (本番) の **dual-runtime** にする。
両 runtime は共有の `src/app.ts` の `buildApp` を使い、entry (`src/index.ts` が Bun、`src/worker.ts`
が Workers) が runtime 固有の部分だけを渡す。

### 1. singleton を「ロード時の const」から「初回 init の `export let` と ESM の live binding」へ

`db` / `redisStorage` / `auth` / `Sentry` backend を module のロード時に構築すると、Workers の
per-request env (Hyperdrive / Upstash の binding は `env` 引数経由でしか来ない) を読めない。そこで次のようにする。

- `export let db` と `initDb(connStr)` (`db/client.ts`)、`export let auth` と `initAuth()` (`src/auth.ts`) などにする
- Bun は `isBunRuntime()` (`typeof Bun !== "undefined"`、`src/env.ts`) で module のロード時に自動 init する
- Workers は `worker.ts` の `initRuntime(env)` が初回リクエストで `env` を `process.env` に反映し、
  `initDb`、`initRedis`、`initAuth` の順に 1 度だけ init する (isolate が warm な間は env が変わらない)

ESM の live binding により、`import { db }` する repository / handler 群は init 後の値を参照でき、
呼び出し側はほぼ無改修で済む。

### 2. DB は Postgres のまま Hyperdrive を挟む

drizzle の `node-postgres` ドライバを両 runtime で共有する。接続文字列だけが異なり、
Bun は `DATABASE_URL`、Workers は Hyperdrive binding (`env.HYPERDRIVE.connectionString`) を使う。schema /
既存の `drizzle/*.sql` / repository / better-auth の `provider:"pg"` は無改修である。Hyperdrive を介すことで
`runInTransaction` の interactive tx、`pg_advisory_xact_lock`、`SELECT ... FOR UPDATE` が Workers でも
保たれる (race の直列化が正しさに関わるため必須)。

### 3. TTL store は Workers=Durable Objects / Bun=in-memory (ADR-0019 が supersede)

当初は `src/redis.ts` が `RedisStorage` (better-auth の secondaryStorage) と `incrementRateWindow` の
interface 越しに、node-redis (Bun) と Upstash REST (Workers) を init 時に選択していた。2026-09-20 に
[ADR-0019](./0019-ttl-store-durable-objects.md) で Redis を撤去した。現在の backend と選択方法は ADR-0019 の Decision を定義元とする。

### 4. RPC は fetch ハンドラで直接配信する (connect-node proxy 廃止)

`src/rpc/fetch-handler.ts` が `createConnectRouter` と `createFetchHandler` で `registerRoutes` を
fetch ハンドラとして配信する。`node:http` の内部 server と `/rpc/*` proxy は両 runtime で廃止した。
`registerRoutes` と RPC handler は無改修である。ADR-0001 の content-length 回避は proxy が消えたことで不要になり、
`src/proxy-helpers.ts` ごと削除した。

### 5. 静的配信は Bun.file / Workers Static Assets

`buildApp` は共有ルートをすべて登録した後、runtime 固有の静的配信を `mountStatic` コールバックで受ける。
Bun は `serveStatic` と `Bun.file` の SPA fallback、Workers は `env.ASSETS.fetch` (wrangler の `assets` で
`run_worker_first: true` と `not_found_handling: single-page-application`) を使う。worker を常に先に走らせる
ことで、`/` の loginShortcut などが静的な index.html に吸われない。

### 6. 背景タスクは ctx.waitUntil (AsyncLocalStorage 経由)

`src/background.ts` が `AsyncLocalStorage` に `ctx.waitUntil` を per-request で結び付け、`runBackground()`
が `hooks.after` の audit log / welcome email を登録する。Bun では fire-and-forget のままにする。

### 7. Sentry は facade + backend 注入

`src/sentry.ts` は SDK に依存しない facade で、entry が backend を注入する (`src/sentry-bun.ts` が
`@sentry/bun`)。handler が import する facade に SDK 依存を持たせないことで、Workers バンドルへの
Bun 専用 SDK の混入を防ぐ。Workers は `src/sentry-cloudflare.ts` が `@sentry/cloudflare` の backend を
注入し、`worker.ts` の export default を `Sentry.withSentry` でラップする (SENTRY_DSN 未設定時は console fallback)。

### workerd 固有の 3 点 (実機検証で発見・修正)

1. **rate-limit の body clone による hang**: `c.req.raw.clone().json()` が workerd では body の二重読みになり
   "hung" になる。Hono の body cache (`c.req.json()`) で raw を 1 度だけ読み、`auth.handler` も同じ cache
   (`arrayBuffer`) から新しい Request を再構築する。
2. **fire-and-forget による hang**: await されない promise を workerd は response 後に "hung" として扱う。
   ctx.waitUntil で解決する (上記 6)。
3. **DB verification 消費の hang**: `verification.storeInDatabase: true` の DB token 消費が workerd
   では完走しない。`isBunRuntime() && isLocalEnvironment()` とし、Workers では false にする (本番と同じ
   secondaryStorage)。Bun-local の e2e は postgres からの token 抽出を維持する。

### 本番デプロイで発見した workerd 固有 2 点

spike では予測しきれず、本番 (auth.taimei-code.com) で初めて当たった 2 件である。

4. **react-email の render の lazy CJS init が実行されない**: `render` の名前付き import も `import * as ReactEmail`
   の namespace import も、esbuild は同じ未 init の参照 (`render2`) に畳み、workerd で
   `render2 is not a function` になる (magic-link の送信が 500)。`await import("@react-email/components")`
   の dynamic import で実行時に module の init を強制して回避した (auth.ts / send-welcome.ts / send-invitation.ts)。
   spike-4 の「namespace import で解決」は最小 spike のバンドルでのみ成立し、better-auth などを含む本実装の
   バンドルでは成立しなかった。
5. **vite の base=/auth/ に対する static rewrite の欠落**: index.html は `/auth/assets/*` を参照するが、Workers
   Static Assets は web/dist を `/` 直下に配信する。worker.ts の mountStatic で `/auth` を剥がしてから委譲
   しないと `/auth/assets/*` が実在せず、not_found_handling=single-page-application が index.html (html)
   を JS として返し、SPA が SyntaxError で真っ白になる。Bun の index.ts の serveStatic rewriteRequestPath
   (/auth を '' に) と等価の処理が Workers の entry に必要だった。spike-5 は /account の deep link だけを検証し、
   SPA エントリ /auth/ の rewrite を見落としていた。

## Why

- **live binding で呼び出し側を無改修に保つ**: 移植の影響を repository / handler に広げず、init の
  3 singleton と entry に閉じる。Workers の per-request env 制約を満たしつつ、Bun も従来の動作を保つ。
- **capability で選ぶ (runtime の判別を避ける)**: TTL store の backend は DO binding の有無で、
  DB verification は「その runtime で DB token の消費が完走するか」という capability で選ぶ。`storeInDatabase`
  だけは workerd の不具合回避のため `isBunRuntime()` を使うが、これは capability の近似である。
- **Postgres のままにすることが正しさを守る**: 削除 / 除名 / orphan の cascade は tx の原子性に依存する。D1 / Turso /
  Neon-HTTP はこの型の interactive tx を扱えず、書き換えると正しさに関わる経路を作り直すことになる。
  Hyperdrive なら接続層の差し替えで済む。

## 検討した代替案 (不採用) と再評価のきっかけ

| # | 案 | 不採用理由 | 再評価のきっかけ |
|---|---|---|---|
| A | auth も Vercel | 常駐 RPC proxy と常駐接続が serverless と非互換で、再設計コストが大きい | — |
| B | Cloud Run | Dockerfile 無改修で動くが、課金アカウントの有効化が必要で cold start もある。$0 の厳守と Workers の edge との親和性で見送り | Workers の無料枠を超過した時 / Docker 資産を活かしたい時 |
| C | DB を Cloudflare D1 | interactive tx 非対応 (batch のみ)。tx を多用する経路を書き換えることになる | better-auth / アプリが batch tx 設計になった時 |
| D | DB を Turso (libSQL) | interactive tx は可能だが、pg から sqlite への方言変更と migration の全書き換えが要る | 外部 Postgres への依存を消し、完全に edge native にしたい時 (別 ADR) |
| E | DB を Neon HTTP ドライバ | interactive tx 非対応。Hyperdrive または neon-serverless が必要 | — |
| F | rate-limit を Cloudflare KV | 結果整合のためカウンタがずれる。atomic な INCR ができない | 強整合が要らない用途のみ |
| G | Bun を捨て Workers 専用 | テスト / compose / fallback を失う。dual の方が安全 | Workers の運用が安定し、Bun の維持コストが上回った時 |
| H | DB を Cloudflare ネイティブ Postgres | 2026-06 時点で存在しない。Cloudflare の Postgres 窓口は Hyperdrive (接続層) と PlanetScale 提携 ($5/月〜、無料枠なし) だけで、D1 は SQLite。$0 を破るうえ、接続層は結局 Hyperdrive で Neon と同じ | Cloudflare が無料枠付きの自社 Postgres を出した時 (blog.cloudflare.com の tag/postgres を監視) |

## Consequences

- **dual-runtime の維持コスト**: 2 runtime 分の init 経路と backend 実装を持つ。代わりに Bun の fallback
  (compose / テスト / Cloud Run への退避路) を保持できる。実装時の検証では Bun のテスト suite の全 pass と、
  Workers の boot / health / RPC / magic-link を実機で確認した (観測は analysis.md)。
- **移植に伴う付随変更**: `@types/pg` を追加した (pg を直接 import するようになったため)。rate-limit の 2 本
  (`src/rate-limit.ts` / `src/invitation/rate-limit.ts`) は backend の直接呼び出しから `incrementRateWindow`
  interface 経由にした。`AUTH_SERVICE_KEY` が production で未設定の時の fail-fast は、entry 起動時の `process.exit`
  (`src/index.ts`) と `/rpc/*` の 503 (`src/app.ts`) の 2 段である。`.gitignore` に `.dev.vars` と
  `.wrangler/` を追加した (dev の secret と wrangler の一時ファイルを除外する)。
- **本番固有の未確認 / 未了**: (1) 本番 Hyperdrive の pool での tx の固定は、`pg_advisory_xact_lock` と
  `SELECT FOR UPDATE` の 2 並列 tx が直列化することを本番の remote Hyperdrive で実機確認し **完了** した
  (lost update なし、`A:enter,A:exit,B:enter,B:exit`)。(2) resend の実送信の疎通は、Resend で
  `transactional.taimei-code.com` を検証し `AUTH_FROM_EMAIL_*` を設定して **完了** した。(3) `@sentry/cloudflare` の
  配線は `Sentry.withSentry` と backend 注入で **完了** した (SENTRY_DSN の設定で有効化)。残りは (4) 各無料枠の
  実数値 (Neon 0.5GB / 100 compute-h など。launch 後の実トラフィックで再確認する)。
- **`storeInDatabase` の根本原因は未追跡**: workerd で DB verification の消費が hang する根本原因 (better-auth
  の DB token 消費の tx / query パターン) は本番では通らない経路のため深追いしていない。再評価のきっかけは better-auth が
  Workers 対応の DB verification 版を出した時とする。
- **$0 は無料枠内で成立する**: Workers / Durable Objects / Neon / Hyperdrive。日本単一・個人運用の低トラフィックを
  前提とし、launch 時に各枠の実数値を再確認する。
- **Upstash free tier の無活動アーカイブ (撤去済み)**: 30 日間データ操作が無いと DB がアーカイブされて REST
  endpoint が消え、2026-09-03 に本番で magic link の送信が 500 になった。毎日の keep-alive cron でしのいでいたが、
  ADR-0019 で Upstash ごと撤去した。
- **Hyperdrive の query caching は無効にする**: Hyperdrive は既定で parameterized な SELECT の結果を
  max_age 60s / stale-while-revalidate 15s で cache する (tx 内の読み取りと mutation は対象外)。この service
  の membership の読み取り (`findMembershipsByUserId`) は cache の対象になるため、signup、事業所作成、`/account`
  の直後に `/api/account/memberships` が作成前の空の結果を返し、SessionGuard が `/auth/signup/company` へ
  戻す (2026-09-03 に本番で再現。約 60s 後に正しく 1 件返る)。認証と membership の読み取りは stale を
  許容できないため、本番の config は `wrangler hyperdrive update <id> --caching-disabled` で cache を切り、
  `wrangler hyperdrive get <id>` の `caching.disabled: true` を確認する (analysis.md の spike-1 で
  「本番の query caching の再確認」として持ち越していた項目の結論)。config を作り直す時は
  `--caching-disabled` を付ける。回帰確認は QA-MR-10。
- **本番の secret と設定**: `wrangler secret put` で `AUTH_SECRET` / `AUTH_SERVICE_KEY` /
  `SENTRY_DSN` を注入する。`hyperdrive.id` を実際の config に、`vars` を本番値にする。DNS で `auth` subdomain
  を Workers に向ける。migration は CI から drizzle-kit で流す (Worker 内では実行しない)。

## Sources / Related

- 実機検証の観測値と ground-truth: [`0011-cloudflare-workers-migration.analysis.md`](./0011-cloudflare-workers-migration.analysis.md)
- ADR-0001 (RPC proxy の content-length) は、この ADR での proxy 廃止により obsolete になった
- ADR-0002 (SPA routing) / ADR-0004 (cross-subdomain cookie) は静的配信と Cookie の前提
