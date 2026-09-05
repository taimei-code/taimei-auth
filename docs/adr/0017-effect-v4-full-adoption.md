# ADR-0017: Effect v4 を全面採用する (Repository の drizzle だけ Promise のまま残す)

## Status

Accepted (2026-09-04、設計レビュー完了)。判断主体は maintainer。Stage 1〜4 を `feat/effect-v4-stage1` で実装 (Stage 2〜4 は同日、同 branch)。

関連: ADR-0009 (supply chain、§C `trustedDependencies`、§H `minimumReleaseAge`)、ADR-0011 (Workers dual-runtime)、ADR-0012 (4 層と membership guard)、`docs/qa/manual-regression.md` の QA-MR-03 / QA-MR-11。

## Context

taimei-auth は Bun + Hono + better-auth + drizzle/pg + ConnectRPC で、Workers (workerd) と Bun の 2 つの runtime で動く。

失敗の表現は 4 系統に割れていた。Guard は Result object、Use-case は `{ ok, reason }`、MFA は `MfaFailure`、RPC は `ConnectError` の throw。しかも Hono には `onError` が無い。handler の未捕捉例外は Hono が飲み込んで 500 にし、Sentry には届いていなかった (`hono-base.js` の `errorHandler` は rethrow しない)。

Effect v4 は 2026-09-04 時点で stable 未リリースである。npm の `latest` は 3.22.1、`rc` は 4.0.0-rc.112、stable の目標は Q3/Q4 2026。事前調査 (2026-09-03) は反対点を 7 つ挙げた。

- RC 採用者は「検証役」になる
- ADR-0009 の 7 日規則と RC 周期 (2〜5 日) が衝突する
- http / sql / rpc / observability は `effect/unstable/*` にあり、stable 後も semver の外にある
- workerd には module-level `ManagedRuntime` の dispose 契機が無い
- DB 境界は better-auth の drizzleAdapter 要求で Promise のまま閉じる
- 1 人体制で手動 QA が多い
- v3 は feature freeze で、巻き戻しは退行方向になる

それでも採用した。理由は 3 つある。

- maintainer が「依存注入とエラー・副作用の構造化を Effect に可能な限り寄せる」「中途半端な採用はしない」を明示した
- PoC (draft PR #165) が local workerd と Bun で必須条件 9 項目 (request ごとの ALS store が Effect の scheduler を越えて保持されること、per-request Pool と module-level runtime の共存、tx、`waitUntil`、bundle 上限 等) を満たした
- Guard 層の prototype (draft PR #166、Guard の内側だけを Effect 化し公開 API は Promise のままにした形) で、配置、責務、依存方向、契約、テスト方法、慣習の適合を確認できた

remote workerd と本番 bundle の起動は local の観測で足りると判断し、本番前の確認は QA-MR-11 に置いた。

## Decision

**物理的に Effect にできない境界を除き、`src/` と `management/` はすべて Effect 様式 (Context.Service / Layer / ManagedRuntime / Data.TaggedError) で書く。1 つの層の中に新旧 2 様式を残さない (Stage 完了時)。**

物理的な境界は 3 つ、それに pool の request scope を加えて 4 つある。

| 境界 | 理由 | 扱い |
|---|---|---|
| Repository (`db/`、drizzle) | better-auth が drizzleAdapter (Promise instance) を要求する | `db/` は Promise のまま無変更。Effect face は `src/<domain>/ports.ts` (Context.Service) + `wiring.ts` (live Layer) |
| Hono / ConnectRPC の handler signature | `(c) => Promise<Response>` / Connect の handler 契約 | adapter `runRoute` (`src/handlers/run-route.ts`) / `runMiddleware` (同) / `runRpc` (`src/rpc/run-rpc.ts`) が Effect を run し、failure を wire に、boundary error と defect を Sentry + 500 に写像する唯一の点 |
| better-auth の hook / callback | `throw ctx.redirect()` / `APIError` の例外規約 | 本体は Effect、境界で `runPromise` して throw に戻す (Stage 4) |
| pool の request scope | better-auth が同じ `db` (RoutingPool) 経由で query する | `db/client.ts` の ALS のまま。Effect Context に Pool を載せない。`src/background.ts` の ALS も carrier として残す |

構成:

- runtime: `src/runtime.ts` の `getRuntime()` (lazy accessor、isolate / process に 1 つ)。`AppLayer` は I/O resource を持たない (pool は ALS、Redis client は `initRedis()` が持つ)。生成は最初の `getRuntime()` まで遅延する。Workers は `bootstrap(env)` で `initAuth()` の後、app を memo する前に 1 回呼んで fail-fast にする。Bun の entry と fixture test は最初の adapter 呼び出しで作る。`initAuth()` との順序 assert は置かない (`AuthApiLive` は `auth` を呼び出し時に読む)
- failure: すべて `Data.TaggedError`。各 class が wire code `error` と `status` を持つ (catalog 分散、`src/membership/guard/errors.ts` が guard の正本)。`Schema.TaggedError` にしないのは failure を decode / encode する経路が無く、Schema を持ち込むと Workers bundle が gzip で約 90 KB 増えるため
- boundary error: サードパーティ境界の失敗は `DbError` / `AuthApiError` / `RedisError` / `EmailError` (`cause: unknown`) で運び、unknown catch を許容する。producer (`tryDb` / `tryAuthApi` / `tryRedis` / `tryEmail`) の無い class は置かない
- Sentry: adapter は `cause` そのものを渡して grouping を保つ。boundary error は `level: "warning"`、defect は `level: "error"`。未認証 route (`/api/mfa/challenge`、`/auth/*`) の障害連打で error quota を食わないための区別で、Hono 既定が出していた `console.error` も adapter が残す。(2026-09-05 追記) better-auth の router が握る throw は `src/auth.ts` の `onAPIError.onError` が `captureThrown` (同じ `classifyCause`) で Sentry へ送る。4xx の APIError は送らない。`onRequest` 段 (rate limiter の Redis 読み) の throw は router が onError に渡さず `auth.handler` の reject にするため、`src/app.ts` の mount が拾って同じ `captureThrown` に送る。endpoint 内で throw した APIError は 5xx でも dispatch が Response に変換するので onError に来ず、Sentry に出ない。`redisStorage` は生の driver Error を投げて boundary error に当たらないため error level になり、Redis 断時は未認証 route から error が連打される (観測後に `redisStorage` の RedisError 化を再判断)
- defect: E に載らない throw はバグのみ。adapter が `runPromiseExit` で Die も拾う。Cause の reasons は全走査し、defect を全部報告してから wire failure があればそれを返す。catalog 外の形の failure (`error` / `status` を持たない) は 200 にせず 500 にする
- tx: `Transaction` service (Stage 2)。tx 内の failure は常に rollback (sentinel throw を service 内に隠す)。tx 後の副作用は `tapError` で外に置く
- 依存注入: deps factory と repository の named import を全廃し、Context.Service を `yield*` する。時刻は `Clock`、ID は `IdGenerator`。テストは test Layer (`Layer.succeed`) で差し替え、`mock.module` と `@effect/vitest` は使わない
- test の DB 接触: seed (前提状態の書き込み) / 観測 (事後状態の読み取り) / cleanup の実体は `db/testing/*` (Promise、db/ が所有) に置き、src の test はそれを `liftAll` で持ち上げた `TestDb` service (`src/__tests__/test-db.ts`) を `yield*` する。理由は 3 つ: db/ は effect を持てない (本 ADR の境界表 1 行目)、schema と drizzle は db/ の所有物 (db/CLAUDE.md ルール 1)、test 本体を 1 つの `Effect.gen` にして production と同じ idiom (Promise module → `liftAll` → `Context.Service`) にするため。test は repository と drizzle を直接呼ばない (ゲートは `src/__tests__/effect-boundary.test.ts`)。e2e は Effect の範囲外で、`e2e/fixtures.ts` が同じ module を Promise のまま使う
- 非同期: `Effect.all` / `Effect.timeout` / `Effect.retry`。timeout は境界 service に既定値を置く (Redis 2s、email 10s、Bun 起動の Redis ping 10s)。retry は冪等な境界 (Redis 読み取り系、keepalive の SET) にだけ `src/redis-service.ts` の policy (`withRedisRetry`) で宣言し、再試行 3 回、backoff の合計 1s 未満 (attempt ごとの timeout は別。帰結は Consequences)
- zod は残す: 400 の `details` が zod v4 の message 文字列 (`"Invalid email address"` 等) を wire として運ぶため、Effect Schema では byte-invariant を保てない。`parseZodBody` が zod の `safeParse` を `Effect<T, InvalidArgument>` に持ち上げる
- 対象外: `web/` と `@core` 共有 module (effect-free 維持、`web-shared-core-runtime-free.test.ts`)、SDK `packages/auth-client` の公開 API (effect 3.x 据え置き、v4 stable 後に別件)、`db/`

Stage は層単位で進める。Stage の途中では main に 2 様式が共存してよい。完了 PR で旧様式ゼロを `src/handlers/__tests__/no-transport-tx.test.ts` (Stage 1) と `src/__tests__/effect-boundary.test.ts` (Stage 2〜4 のゲート) に累積する invariant で固定する。

| Stage | 範囲 | 完了ゲート |
|---|---|---|
| 0 prototype | runtime + `runRoute` + Guard + 2 route を `wrangler dev --remote` で確認 | QA-MR-11 |
| 1 Transport + Guard | runtime / adapter 3 つ / Guard 全 entry (Effect-only、ports) / error class / handlers 20 route + RPC + middleware の flip / 本 ADR / QA-MR-11 追加。use-case は `fromResult` (`WireFailure` 橋渡し) で暫定包み | handlers から旧 API 呼び出しゼロ、fixture 40 件 pass、e2e pass、QA-MR-03 + 11 |
| 2 Use-case | account / company / invitation / membership の 4 domain、`Transaction`、ports の残り、domain error class、`Clock` / `IdGenerator`、`AuditLog` service | `src/` から `runInTransaction` 直呼びゼロ、repository runtime import ゼロ (`db/repositories` / `db/transaction` の runtime import は `src/*/wiring.ts`、`src/id-generator.ts`、`src/transaction.ts`、`src/auth.ts` のみ。型 import は可) |
| 3 MFA | `src/mfa/` の error class 化、ports の Context.Service 化、`WireFailure` 削除 | `MfaFailure` / `WireFailure` ゼロ |
| 4 seam・runtime primitive | hook / `auth.ts` callback / `Background` / `SentryService` / `Redis` (`src/redis-service.ts`、読み取りと keepalive だけ retry、timeout 2s) / rate-limit middleware / `EmailSender` (`src/email/*` を Effect 化、timeout 10s、retry なし) / `Effect.all` / entries / CLI | `Promise.all` / `runBackground` (`src/background.ts` 以外) / `Sentry.capture*` 直呼び (`src/sentry.ts` と adapter 以外) ゼロ |

依存: `effect` は `4.0.0-rc.112` に exact pin し、stable (4.0.0) か security advisory まで動かさない。Dependabot は `effect` の `< 4.0.0` (RC) だけを ignore する。RC 追従 PR を出すと毎週 `minimumReleaseAge` に block されて CI が落ちる一方、stable と security update は出したいため。security advisory は ADR-0009 §H の手順に従う。`@effect/platform-bun` / `@effect/vitest` / `@effect/opentelemetry` は追加しない (RC package を増やさず、`management/` CLI は `getRuntime().runPromise` で走らせる)。`effect/unstable/*` は biome で全域 import 禁止、`db/` と `web/src` からの `effect` import は `src/__tests__/effect-boundary.test.ts` と biome で禁止する。

## Stable 移行手順

rc.112 → 4.0.0 を 1 PR で上げ、全テスト + typecheck で API 差を検出する。同じ PR で Dependabot の ignore を外す。RC 固有の API 差 (`catchAll` → `Effect.catch`、`Effect.merge` 無し、`Schema.Enums` でなく `Schema.Enum` 等) は stable 化までは実装時に `node_modules/effect/src` で確認する。

## ADR-0012 を次の点で補う

- Transport に adapter が加わり (Decision の境界表 2 行目)、失敗の写像点はその 3 つに閉じる。`membership/guard/respond.ts` (`guardErrorResponse` / `reasonToGuardError`) は廃止
- Guard の公開 API は `Effect<A, GuardError, R>`。deps factory (`createMembershipGuard` / `makeRequireX`) は廃止し、依存は ports の service を `yield*` する。判定順 (401 → 400 → 403 → 404 → ...) と fail-closed (session 解決だけ 401、membership 断は 500) は不変
- Use-case が ports (`src/<domain>/ports.ts`) を所有し、Repository の Effect face は src 側に置く。`db/repositories/` は薄い Promise のまま。port の method 名は repository の関数名と同一で、ports は `LiftedModule<typeof repo>`、wiring は `liftAll(repo)` として repository module から導出する (port 側で名前を付け替えない。同期 helper `generate*` / `isAcceptable` は `liftAll` の対象外で、必要な側が直接 import する)
- 1 file ≤200 行、1 操作 1 file、Guard は hono 非依存、Transport は tx を所有しない (`src/rpc/user-handler.ts` の既存 Scope out は Stage 1 で動かさない) は維持

## Did not adopt

- 各層の公開 API を Promise<Result> のまま Effect を内側に閉じる (prototype #166 の形) を全段で貫く: 層をまたぐ typed error 合成が起きず、Effect のコストだけ払う。写像点が 1 箇所にならない
- deps factory と default runtime の維持 (Layer / Context 不使用): 「DI を Effect に寄せる」方針と両立しない
- failure を Result object のまま E channel に載せる: catalog と wire の写像層が分散したまま残る
- Effect Schema で body を parse し `details` を再構成する: 理由は Decision の「zod は残す」項。Schema 化は `details` の wire を変える判断とセットの別件
- `@effect/platform-bun` の `BunRuntime.runMain`: CLI 3 本のために RC package を 2 つ抱える理由が無い
- RC を追従する: ADR-0009 §H の bypass を RC ごとに積み、audit trail が汚れる
- drizzle を廃止して Effect の SQL 層に置換する: better-auth の drizzleAdapter 要求で不成立
- hot path (`requireServiceKey` の `/rpc/*`、canary、login-shortcut の `/`) だけ adapter を通さない: 写像点を 3 adapter に閉じる均一性を優先し、request ごとの fiber 1 本と Promise 1 往復を受け入れる。計測で問題になった時点で `ManagedRuntime.runSyncExit` を使う同期版 adapter を足す
- Stage 1 の `fromResult` (use-case の Promise<Result> 橋渡し) で reject を `DbError` に分類する: use-case の reject にはバグも含まれ、一律 `DbError` にすると Sentry の warning に紛れる。defect のまま扱い、Stage 2 で use-case が typed failure になった時点で橋渡しごと消した (`WireFailure` / `fromResult` は存在しない)
- request-scoped の `RequestContext` service (headers / client を adapter が provideService する): Guard と use-case は `Headers` を引数に取る現行 API で足り、consumer の無いまま毎 request `getClientContext` を計算して provide するだけになった。service は置かず、`getClientContext(headers)` の直接呼び出しを維持する
- `Effect.log*` で既存の `console.warn` / `console.error` を全置換する: 出力行の形が変わり、ADR-0012 の運用契約 (log filter が JSON から `invitation_id` を抽出する) と e2e / QA が拾う local の `[TEST] ...` 行が外れる。運用契約のある行は `Effect.sync(() => console.*)` のまま置く
- `auth.ts` から静的に辿れる module (`auth-plugins/*`、better-auth callback、`mfa/totp/challenge-required.ts`) が `runtime.ts` を静的 import する: `runtime → auth-service → auth → plugins → runtime` の環で `AuthApiLive` が TDZ になる。関数内の `await import("./runtime")` に限る

## Consequences

- 認可入口と tx 制御の書き換えで重篤度は Major 以上。実 workerd + 実 binding での確認 (QA-MR-11 の runtime 部分と QA-MR-03) は `deploy.yml` の preview smoke (`scripts/preview-smoke.sh`) が毎デプロイ自動で行い、落ちれば `wrangler versions deploy` に進まない。手動で残るのはデプロイ後にブラウザで `/account` を触る QA-MR-11 の手順 2〜3 だけ (認証付き経路の runtime 機構は `/health` と同じで、残るリスクは adapter の Sentry 送信と `wrangler rollback` で受ける)
- Stage 2 以降は素の TS に戻せない (v3 は feature freeze)。Stage 4 まで進めたため、戻す手段は branch の破棄だけ
- bundle は Stage 1 完了時点で Worker gzip 1,722,391 B (main 比 +54,844 B)、Stage 4 完了時点で gzip 1,805,422 B / raw 10,285,277 B (main 比 +137,875 B、上限 3,145,728 B の 57%)
- 現行で Sentry に届いていなかった handler の未捕捉例外が adapter 経由で届くようになる (Sentry event が増える。level の区別は Decision の Sentry 項)。session-aware redirect (`authEntryRedirect`) は login-shortcut と同じく fail-open にし、障害時は SPA を返す
- `Redis` の retry 対象 (get、keepalive) は 2s timeout が attempt ごとに掛かる (Decision の非同期項の値)。Redis が応答しない時の worst case は約 8.7s (4 attempt + backoff) で、`/api/mfa/challenge` の読み取りがこの経路にあるため Redis 断のあいだ応答が延びる
- `EmailSender` の 10s timeout は fiber を interrupt するだけで、Resend への HTTP は取り消せない。遅延して届いた送信は「`EmailError` を返したが送られた」になりうるため、caller は `EmailError` を再送の根拠にしない (retry を置かないのも同じ理由)
- `Transaction.run` の callback 内 program は別の root fiber で走り、外側の interrupt では止まらず commit まで進む (rollback の契機は Fail / Die のみ)。tx を timeout や並列失敗で interrupt する呼び出し元は現在無い。置く時は `runThroughCallback` に interrupt の転送を足す
- effect rc.112 は `msgpackr` と platform 別 prebuilt の `@msgpackr-extract/*` (optionalDependencies) を lockfile に持ち込む。ADR-0009 §C の判断: install script は不要 (prebuilt binary、CI / Dockerfile は `--ignore-scripts`)、到達経路は `effect/unstable/*` (biome で import 禁止) のみで Workers bundle にも入らないため `trustedDependencies` は `[]` のまま。platform 別 optional dep は esbuild と同型で、RC を上げる時に 7 日規則で lockfile から落ちる可能性がある。その時は ADR-0009 §H の手順で全 platform を列挙する
