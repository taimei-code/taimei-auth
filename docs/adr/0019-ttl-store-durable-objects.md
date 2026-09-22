# ADR-0019: Redis を撤去し、TTL store を Workers では Durable Objects、Bun では in-memory にする

## Status

Accepted (2026-09-20)。判断主体は maintainer。実装は 3 つの PR に分ける: この ADR と runner stage の撤去、Durable Object class と migration の追加、Redis 撤去の本体。この ADR は ADR-0011 の Decision 3「Redis は Bun=node-redis / Workers=Upstash REST」と Consequences の Upstash 項、ADR-0014 の runner / prod-deps stage に関する部分 (Status に列挙) を supersede する。

関連: ADR-0011 (Workers 移行)、ADR-0014 (Docker stage)、CONTEXT.md の **session** / **試行枠** / **MFA チャレンジ** (TTL store の項は Redis 撤去の PR で登録する)。PoC / Prototype の観測値は PR #197 / #198 にある。

## Context

TTL 付きの短命な状態 (session / verification / cookieCache (better-auth `secondaryStorage`)、試行枠 4 経路の計数、MFA チャレンジ) を置く store を、この ADR では TTL store と呼ぶ。その実体は現在 Redis だけである。本番は Upstash REST、local (compose / e2e / `bun test`) は node-redis で、`src/redis.ts` が init 時に選ぶ (ADR-0011 Decision 3)。

session が Postgres でなくここにある経緯は次のとおりである。2026-03-21 (commit `8e04363`) に「セッション L2 キャッシュ」の意図で `secondaryStorage` に Redis を渡したが、better-auth はこの設定で `storeSessionInDatabase` を既定 false にするため、cache のつもりで入れたものが session の唯一の置き場になった。以後 ADR-0011 (Workers で DB verification 消費が hang する) と ADR-0016 (MFA チャレンジを session と同じ置き場に置く) がこの構成を前提に積み上がり、この ADR の時点では「Postgres の負荷対策」ではなく「TTL 付き短命状態の置き場を 1 系統にする」ことが正当化になっている。

Upstash free tier は 30 日間データ操作が無いと DB をアーカイブし、REST endpoint が消える。2026-09-03 に本番の magic link 送信が 500 になり、以後は毎日の keepalive cron で凌いでいる (ADR-0011 Consequences)。vendor が 1 つ増え、secret が 2 つ増え、cron とテスト 3 本が「アーカイブされないため」だけに存在する。

Cloudflare KV は結果整合 (最大 60 秒) のため、verification token の単回消費 (`getAndDelete`) と session 失効が壊れる。Durable Objects (DO) は object 内で request が直列化される (input gate) ため、`get → delete` と `incr → expire` が追加の lock なしで atomic になる。PoC で `RedisStorage` の 6 操作 (TTL 失効、並行 `getAndDelete` 10 本で取得 1、並行 incr 20 本の欠落なし) を確認した。

DO は workerd 専用で Bun プロセスから触れない。local を Redis のまま残す案と Redis を全廃する案を比較し、後者を採った。

## Decision

- **Workers の TTL store は DO `KvStore`** (`src/kv-store.do.ts`) とする。1 key = 1 object (`getByName(key)`)、storage に `{ value, expiresAt }` の 1 entry を置き、TTL は `setAlarm(expiresAt)` からの `alarm()` で `deleteAll` する。`get` は期限切れを null として隠し、削除は alarm だけが行う (read path に write を置かない)。`incrementWindow` は Redis の `MULTI INCR + EXPIRE` と同じく毎回 TTL を延長する。TTL 0 以下は「既に期限切れ」で、無期限になるのは TTL 未指定だけである (better-auth は全 key に TTL を渡すので実際には無期限の key は無い)
- **Bun の TTL store は in-memory** (`src/kv-store.memory.ts`) とする。`bun test` と `bun run src/index.ts` (単一 process) が使う。テストの観測面 `keys(prefix)` / `ttl(key)` は `getMemoryKvStore` 経由に限り、biome の `importNamePattern` で production からの import を禁じる
- **`RedisStorage` / `Redis` service / `RedisError` の名前と契約は変えない**。better-auth `secondaryStorage`、use-case 4 経路、`/health` の `redis` check は無変更で適合する (追記 2026-09-20: 契約はそのままで、名前は `TtlStorage` / `TtlStore` / `TtlStoreError` に、`/health` の check key は `ttlStore` に改名した)
- **local 実行は `wrangler dev`** (`scripts/wrangler-dev.sh`) とする。compose と e2e は dev stage の image に本物の Node.js binary を重ねて起動する (oven/bun の `node` は bun への shim で、wrangler が拒否する)
- **Upstash / node-redis / keepalive cron を撤去する**。`redis` / `@upstash/redis` の依存、`UPSTASH_*` secret 2 個、compose の `auth-redis`、CI の redis service、`triggers.crons` を消す
- **runner stage を撤去する**。本番 artifact は wrangler bundle (devDependencies も同梱) で、pruned runner image を使っていたのは compose と smoke script だけだった。compose が wrangler dev (dev stage) になる以上、runner を維持する理由が無い。位置契約 (既定 target = dev) は維持する (ADR-0014 Status)
- **Bun runtime は本番 fallback ではなくなる**。in-memory の session は process 再起動で消えるため、ADR-0011 が保持していた Cloud Run への退避路は成立しない。`src/index.ts` は `bun run dev` と consumer repo の e2e (`bun run src/index.ts`) のための開発 entry として残す
- 型は `wrangler types --include-env=false` の生成物 `worker-configuration.d.ts` を commit し、CI の `--check` でずれを止める。`Env` は `src/worker.ts` の手書きのまま

## Alternatives

- Cloudflare KV: 結果整合で単回消費と失効が壊れる。設計上の除外
- local は Redis のまま、本番だけ DO にする案: テスト変更 0 の最小 diff だが local に Redis が残り、`bun test` と本番の backend が違うことも今と同じ
- shard 型 DO (N 個の object に hash 分散): 1 key = 1 object より code が長く、TTL sweep が要る
- `@cloudflare/vitest-pool-workers` で DO 契約テストを repo に持つ: 新規 dependency が要る。DO の原子性は platform の保証で、`bun test` は in-memory を、DO は e2e (wrangler dev) と本番 QA で観測する
- `wrangler types --include-env`: `process.env` を `Cloudflare.Env` で augment するため、`delete process.env.X` を書くテストが TS2790 で落ちる
- alchemy / Bun から miniflare を直接起動: 別 PoC で棄却した (wrangler dev が担う bundle / assets / Hyperdrive emulation を自前で組む規模になる)

## Consequences

- 切替時に既存 Upstash の session / verification は引き継がれず、全ユーザーが再ログイン (magic link 1 回) になる。発行済みの magic link と招待 link は無効になる。個人運用の規模のため告知はしない
- DO の lifecycle change (migrations) を含む bundle は `wrangler versions upload` で受け付けられない。deploy.yml は upload → smoke → deploy の経路しか持たないため、DO class と migration を足す PR は merge 前に手元で `bunx wrangler deploy` (lifecycle change だけを本番へ) してから merge する。lifecycle change の適用後は、それより前の version へ rollback できない。Redis 撤去の PR の rollback 先はその version で、Upstash secret を消すまで有効
- Preview URL は DO を持つ Worker では生成されない (Cloudflare の制約。DO class を足した version から実測)。deploy.yml の gate は「新 version を 0% で deployment に加え、`Cloudflare-Workers-Version-Overrides` header で指名して本番 URL を smoke し、通れば 100%、落ちれば旧 version 100% に戻す」に置き換えた。override が適用されないと旧 version の 200 で smoke が何も検証せずに通るため、`version_metadata` binding の id を `/health` の `version` で返し、smoke が最初に一致を確かめる。手動 `wrangler deploy` は config に無い `preview_urls` を false に戻すが、Preview URL を使わなくなったので影響しない
- Upstash の廃止 (secret 2 個の削除と DB 削除) は Redis 撤去の PR の deploy と QA-MR-03 / 05 / 10 の当日に行う
- devDependencies 誤分類の behavioral な検知 (runner image での `bun build` probe) は持たない。本番 artifact に影響しないため、残るのは package.json の section の衛生で、biome `noRestrictedImports` の静的検査が担う
- `bun test` は in-memory を観測し、DO は wrangler dev 上の e2e と本番 QA でしか観測しない。DO 固有の性質 (input gate の原子性、alarm) は platform 側の保証に依る
- DO は初回 request の地点の近くに作られる。日本単一運用のため影響は無いと見る
- Workers Free のまま動く (SQLite backend の DO は Free で使える。ADR-0011 の $0 制約は維持)。Free の上限は日次 (00:00 UTC reset) で、超えるとその操作が失敗する: requests 100,000 / 日、SQLite rows written 100,000 / 日、rows read 5,000,000 / 日。認証済み request は毎回 session read で DO request を 1 つ以上使い、`set` / `incrementWindow` / `delete` / alarm は全て write に数える。Paid ($5 / 月〜) に切り替える判断軸は 2 つ: (1) Cloudflare dashboard の DO metrics で requests か rows written の日次実測が Free 上限の 50% を超えた時 (残り半分は burst と、攻撃者が任意に増やせる試行枠 incr の余地)、(2) 上限到達の帰結を「認証が落ちる」から「課金される」に変えたい時 (個人運用を越えて他者の業務を担うようになった時点)。どちらにも当たらない間は Free に留める
- Workers runtime の型が global `Response` を上書きするため、`res.json()` の推論が崩れたテスト 2 箇所を `json<unknown>()` に固定した。同種の推論崩れは今後も起きうる
- local の compose / e2e が wrangler dev (workerd) になったため、`verification.storeInDatabase` の Bun 限定 true は `bun test` / `bun run dev` だけに適用され、e2e は本番と同じ secondaryStorage 経路の verification を通る
- consumer repo (taimei) の e2e compose は `bun run src/index.ts` + Redis container を前提にしているが、`src/index.ts` が in-memory で起動するため即座には壊れない。Redis container と `REDIS_URL` の削除は consumer 側の follow-up
