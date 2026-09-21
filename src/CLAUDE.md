# src/ サーバーサイド実装規則

層境界の正本は [`ADR-0012`](../docs/adr/0012-layered-architecture.md)、Effect 様式の正本は [`ADR-0017`](../docs/adr/0017-effect-v4-full-adoption.md)。

## 配置

変更理由を所有する業務ドメインを決め、次に層を決め、両方に合う既存の場所へ置く。所有domain、層、依存方向、test配置を説明できた時点で配置完了とする。

- **Transport** (`handlers/`、`rpc/`): parameter parse、認証、Guard と Use-case の呼出し、response 変換。Effect program は `runRoute` / `runMiddleware` / `runRpc` の adapter で走らせ、failure と defect の client-facing 応答 (`ClientFacingError` → HTTP / Connect) への写像は adapter だけが行う。policy 述語、repository への直接 write、transaction を持たない。
- **Guard** (`membership/guard/`、`membership/policy.ts`): Hono 非依存の操作単位認可。公開 API は `Effect<A, GuardError, R>`。
- **Use-case** (`account/`、`company/`、`invitation/`、`membership/`、`mfa/`): 業務手続、transaction、audit、不変条件、TOCTOU 再検証。失敗は各 domain の `errors.ts` の failure class。
- **Repository** (`db/repositories/`): query を提供し、業務判断を持たない。境界と例外 path は [`db/CLAUDE.md`](../db/CLAUDE.md) が正本。
- domain が肥大化したら技術分類ではなく操作名で下位 directory を作る。`services/` や `utils/` のような無関係な実装の寄せ集めを作らない。
- web から `@core` として参照される module は browser-safe な依存だけを持つ。
- コメントは 1 行に収める。2 行要るなら名前・型・正本のどれかが足りていない。file 冒頭に層・ADR・domain の道案内を書かない。

## Effect様式

- Guard と Use-case は `Effect.fn` で書き、依存は ports の service を `yield*` して取る。combinator は `Effect.fn` の第 2 引数以降に渡し、戻り値に `.pipe` を付けない。method を 1 つだけ呼ぶ時は `Service.use((s) => s.method())`。failure class の instance はそのまま Effect なので `Effect.fail(new X())` と書かない。
- 各 domain は `ports.ts` に Repository の Effect 面 (`Context.Service`、型は `LiftedModule<typeof repo>`)、`wiring.ts` に production 結線 (`liftAll(repo)`) を置く。port の method 名は repository の関数名と同一。同期 helper (`generate*`、`isAcceptable`) は `liftAll` の対象外なので必要な側が直接 import する。
- transaction は `Transaction.run` で取る。tx 内の failure と defect は常に rollback され、tx 後の副作用は `tapError` / `catchTag` で tx の外に置く。
- 時刻は `Clock.currentTimeMillis`、ID は `IdGenerator`、better-auth API は `AuthApi`、TTL store は `TtlStore`、Sentry は `SentryService`、メールは `EmailSender`、fire-and-forget は `Background.run` (渡す effect の失敗は渡す前に catch する)。
- サードパーティ境界の失敗は `errors.ts` の `DbError` / `AuthApiError` / `TtlStoreError` / `EmailError` (`cause: unknown`) で運び、producer は `tryDb` / `tryAuthApi` / `tryTtlStore` / `tryEmail` だけを使う。
- `auth.ts` から辿れる module は `runtime.ts` を import せず `initAuth(runtime)` で受け取った runtime を使う (import 環は fallow の `circular-dependency` が止める)。
- 以上の境界は `src/__tests__/effect-boundary.test.ts` と `src/handlers/__tests__/no-transport-tx.test.ts` が固定する。

## test

- domain test は `<domain>/__tests__/`、Transport test は `handlers/__tests__/` / `rpc/__tests__/`、複数 domain にまたがる invariant は `src/__tests__/` に置く。
- DB に接触する test は `TestDb` service を `yield*` し、`@/db/*` を runtime import しない (型 import は可)。test 本体は `runTest(prefix)` に渡す 1 つの `Effect.gen` で、失敗は `Effect.flip` / `Effect.exit` で failure class として観測する。DB 接触は fixture setup と事後状態の観測に限り、production 境界の例外根拠にしない。
- `@core` の公開面を変えたら `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。workerd 固有挙動は local test で完了扱いにせず、manual regression か `wrangler dev --remote` へ渡す。

## gotcha

- 同じ segment 数の Hono route では static route を parameter route より先に登録する。
- workerd では request をまたいで I/O resource を再利用しない (ADR-0011)。
