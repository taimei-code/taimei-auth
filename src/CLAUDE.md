# src/ サーバーサイド実装規則

`src/` 配下へファイルを追加、移動、変更する時に適用する。

詳細な層境界は [`docs/adr/0012-layered-architecture.md`](../docs/adr/0012-layered-architecture.md) を正本とする。

## 配置を決める順序

1. 変更理由を所有する業務ドメインを決める。
2. Transport、Guard、Use-case、Repositoryのどの層かを決める。
3. domainと層の両方に合う既存の場所へ置く。

新規または移動するファイルは、所有domain、層、依存方向、test配置を説明できた時点で配置完了とする。

## 層の責務

- **Transport**：`handlers/` と `rpc/` に置き、parameter parse、認証、Guard呼出し、Use-case呼出し、response変換を所有する。Effect programを `runRoute`、`runMiddleware`、`runRpc` のadapterで走らせ、failureとdefectのwire写像はadapterだけが行う。
- **Guard**：`membership/guard/` と `membership/policy.ts` に置き、Hono非依存の操作単位認可を所有する。公開APIは `Effect<A, GuardError, R>` で、依存はportsのserviceを `yield*` して取る。
- **Use-case**：`account/`、`company/`、`invitation/`、`membership/`、`mfa/` に置き、業務手続、transaction、audit、不変条件、TOCTOU再検証を所有する。`Effect.fn` で書き、失敗は各domainの `errors.ts` のfailure classを `yield*` で返す。
- **Repository**：`db/repositories/` に置き、queryを提供するが業務判断を持たない。

新規または責務変更を伴うTransportは、policy述語、repositoryへの直接write、transactionを所有しない。

Use-caseとGuardは `membership/policy.ts` の純粋述語を利用できる。

ADR-0012のScope outに記録された既存経路は、独立した抽出作業なしに機械的に移動しない。

既存例外を変更する場合も、Transport側の業務判断またはtransactionを増やさない。

## Effect様式

理由と境界表は [`docs/adr/0017-effect-v4-full-adoption.md`](../docs/adr/0017-effect-v4-full-adoption.md) を正本とする。

- 各domainは `ports.ts` にRepositoryのEffect面 (`Context.Service`) を、`wiring.ts` にproduction結線 (`liftDb`) を置く。`db/repositories/*` と `db/transaction` のruntime importは `*/wiring.ts`、`id-generator.ts`、`transaction.ts`、`auth.ts` に限り、他は `import type` だけを使う。
- transactionは `Transaction.run` で取り、`runInTransaction` を直接呼ばない。tx内のfailureとdefectは常にrollbackされ、tx後の副作用は `tapError` や `catchTag` でtxの外に置く。
- 時刻は `Clock.currentTimeMillis`、IDは `IdGenerator`、better-auth APIは `AuthApi`、Redisは `Redis`、Sentryは `SentryService`、メールは `EmailSender`、fire-and-forgetは `Background.run` のserviceを通す。`Date.now()`、`Sentry.capture*`、`runBackground`、`Promise.all` をuse-caseやhandlerに直接書かない。
- サードパーティ境界の失敗は `errors.ts` の `DbError`、`AuthApiError`、`RedisError`、`EmailError` (`cause: unknown`) で運び、producerは `tryDb`、`tryAuthApi`、`tryRedis`、`tryEmail` だけを使う。
- `auth.ts` から静的に辿れるmodule (`auth-plugins/*`、better-auth callback、それらが呼ぶ `mfa/totp/challenge-required.ts` と `mfa/totp/login-challenge.ts`) で `getRuntime` が必要な場合は関数内で `await import("./runtime")` する。静的importはruntimeとの循環でTDZになる。
- 全ゲートは `src/__tests__/effect-boundary.test.ts` と `src/handlers/__tests__/no-transport-tx.test.ts` が固定する。

## DB境界と既存例外

productionのdomain、Guard、Transportはrepository関数とtransaction helperを利用し、`drizzle-orm` または `pg` を直接importしない。

境界規則と例外pathの正本は [`db/CLAUDE.md`](../db/CLAUDE.md) の「例外 path (正本)」とする。例外を追加する変更はDB境界の設計変更としてreviewする。

## ファイル配置

- domain固有の実装は所有domainの直下に置く。
- domainが肥大化した場合は、技術分類ではなく操作または機能名で下位directoryを作る。
- `services/` や `utils/` のような名前で、無関係なdomain実装を集めるdirectoryを作らない。
- `app.ts` はcomposition rootとして結線を所有する。
- `auth-plugins/` はBetter Authとのintegration seamを所有する。
- `email/` は送信client、template、delivery adapterを所有し、domainの業務手続を所有しない。
- `index.ts`、`worker.ts`、`background.ts`、`auth.ts` は用途を特定できるruntime entryとしてrootに置く。
- domainを持たないruntime primitiveは用途を特定できるroot fileに置き、domain判断を持ち始めた時点で所有domainへ移す。
- `gen/` はcodegen出力として扱い、手動編集しない。
- webから `@core` として参照されるmoduleはbrowser-safeな依存だけを持つ。

## test配置

- domain testは `<domain>/__tests__/` に置く。
- Transport testは `handlers/__tests__/` または `rpc/__tests__/` に置く。
- 複数domainまたはrepository全体のinvariantは `src/__tests__/` に置く。
- DBへ接触するtestは接触をfixture setupと事後状態の観測に限定し、production境界の例外根拠にしない。
- DBへ接触するsrcのtestは `TestDb` service (`src/__tests__/test-db.ts`、実体は `db/testing/*`) を `yield*` し、`@/db/*` をruntime importしない (型importは可)。test本体は `runTest(prefix)` に渡す1つの `Effect.gen` で、失敗は `Effect.flip` / `Effect.exit` でfailure classとして観測する。理由の正本はADR-0017 Decisionの依存注入項。

## 実装時のgotcha

- 同じsegment数のHono routeでは、static routeをparameter routeより先に登録する。
- workerdではrequestをまたいでI/O resourceを再利用せず、requestごとに生成してcloseする。
- workerd固有挙動の実機確認には、必要に応じて `wrangler dev --remote` を使う。

workerdとDB poolの理由は [`docs/adr/0011-cloudflare-workers-migration.md`](../docs/adr/0011-cloudflare-workers-migration.md) と [`db/CLAUDE.md`](../db/CLAUDE.md) を参照する。

## 検証

- 変更したdomainまたはTransportのfocused testを実行する。
- 層またはimport境界を変更した場合は `bun run typecheck` と関連するinvariant testを実行する。
- `@core` の公開面を変更した場合は `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。
- workerd固有挙動はlocal testだけで完了扱いにせず、該当するmanual regressionまたはremote実機確認へ渡す。
