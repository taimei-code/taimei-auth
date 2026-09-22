# src/ サーバーサイド実装規則

層境界は [`ADR-0012`](../docs/adr/0012-layered-architecture.md) が、Effect 様式は [`ADR-0017`](../docs/adr/0017-effect-v4-full-adoption.md) が定義元である。

## 配置

変更理由を所有する業務ドメインを決め、次に層を決め、両方に合う既存の場所へ置く。所有 domain、層、依存方向、テストの配置を説明できた時点で配置を完了とする。

- **Transport** (`handlers/`、`rpc/`): parameter の parse、認証、Guard と Use-case の呼び出し、response への変換を受け持つ。Effect program は `runRoute` / `runMiddleware` / `runRpc` の adapter で走らせ、failure と defect を client-facing の応答 (`ClientFacingError` から HTTP / Connect へ) に変換するのは adapter だけが行う。policy 述語、repository への直接 write、transaction は持たない。
- **Guard** (`membership/guard/`、`membership/policy.ts`): Hono に依存しない、操作単位の認可。公開 API は `Effect<A, GuardError, R>`。
- **Use-case** (`account/`、`company/`、`invitation/`、`membership/`、`mfa/`): 業務手続、transaction、audit、不変条件、TOCTOU の再検証を受け持つ。失敗は各 domain の `errors.ts` にある failure class で表す。
- **Repository** (`db/repositories/`): query を提供し、業務判断を持たない。境界と例外 path は [`db/CLAUDE.md`](../db/CLAUDE.md) が定義元。
- domain が肥大化したら、技術分類ではなく操作名で下位ディレクトリを作る。`services/` や `utils/` のような、無関係な実装の寄せ集めを作らない。
- web から `@core` として参照される module は、browser-safe な依存だけを持つ。
- コメントは 1 行に収める。2 行要るなら、名前、型、定義元のどれかが足りていない。ファイルの冒頭に層、ADR、domain の道案内を書かない。

## Effect様式

- Guard と Use-case は `Effect.fn` で書き、依存は ports の service を `yield*` して取る。combinator は `Effect.fn` の第 2 引数以降に渡し、戻り値に `.pipe` を付けない。method を 1 つだけ呼ぶ時は `Service.use((s) => s.method())` を使う。failure class の instance はそのまま Effect なので、`Effect.fail(new X())` とは書かない。
- 各 domain は `ports.ts` に Repository の Effect 面 (`Context.Service`、型は `LiftedModule<typeof repo>`) を、`wiring.ts` に production の結線 (`liftAll(repo)`) を置く。port の method 名は repository の関数名と同じにする。同期 helper (`generate*`、`isAcceptable`) は `liftAll` の対象外なので、必要な側が直接 import する。
- transaction は `Transaction.run` で取る。tx 内の failure と defect は常に rollback され、tx 後の副作用は `tapError` / `catchTag` で tx の外に置く。
- 時刻は `Clock.currentTimeMillis`、ID は `IdGenerator`、better-auth API は `AuthApi`、TTL store は `TtlStore`、Sentry は `SentryService`、メールは `EmailSender`、fire-and-forget は `Background.run` を使う (渡す effect の失敗は渡す前に catch する)。
- サードパーティ境界の失敗は `errors.ts` の `DbError` / `AuthApiError` / `TtlStoreError` / `EmailError` (`cause: unknown`) で表し、producer は `tryDb` / `tryAuthApi` / `tryTtlStore` / `tryEmail` だけを使う。
- `auth.ts` から辿れる module は `runtime.ts` を import せず、`initAuth(runtime)` で受け取った runtime を使う (import の循環は fallow の `circular-dependency` が止める)。
- 副作用の置き場は「Layer で差し替えられるか」で決める。差し替えられる副作用 (`AuthApi` / `TtlStore` などの service) は program に置く。runtime が所有しない object (`ctx`、`Response`、`process.env`、`throw`) への副作用は、`runPromise` を呼ぶ adapter (`runRoute` / `runMiddleware` / `runRpc`、better-auth の hook) が行う。program はそれを closure で受け取らず、「何をすべきか」を直和型の値で返す (例: `src/auth-plugins/mfa-challenge.ts` の `ChallengeDecision`)。program の入力に `() => void` が混ざり、テストが呼び出し順を recorder で assert し始めたら、この境界が崩れている。
- 以上の境界は `src/__tests__/effect-boundary.test.ts` と `src/handlers/__tests__/no-transport-tx.test.ts` が固定する。

## test

- domain のテストは `<domain>/__tests__/` に、Transport のテストは `handlers/__tests__/` / `rpc/__tests__/` に、複数 domain にまたがる invariant は `src/__tests__/` に置く。
- DB に接触するテストは `TestDb` service を `yield*` し、`@/db/*` を runtime import しない (型 import は可)。テスト本体は `runTest(prefix)` に渡す 1 つの `Effect.gen` にし、失敗は `Effect.flip` / `Effect.exit` で failure class として観測する。DB への接触は fixture の setup と事後状態の観測に限り、production 境界の例外の根拠にしない。
- `@core` の公開面を変えたら `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。workerd 固有の挙動は local のテストで完了扱いにせず、manual regression か `wrangler dev --remote` で確認する。

## gotcha

- segment 数が同じ Hono route では、static route を parameter route より先に登録する。
- workerd では request をまたいで I/O resource を再利用しない (ADR-0011)。
