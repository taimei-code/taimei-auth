# src/ サーバーサイド実装規則

層境界は [`ADR-0012`](../docs/adr/0012-layered-architecture.md) が、Effect の採用範囲は [`ADR-0017`](../docs/adr/0017-effect-v4-full-adoption.md) が、Effect の書き方は `node_modules/effect/AGENTS.md` が定義元である。

## 配置

変更理由を所有する業務ドメインを決め、次に層を決め、両方に合う既存の場所へ置く。所有 domain、層、依存方向、テストの配置を説明できた時点で配置を完了とする。

- **Transport** (`handlers/`、`rpc/`): parameter の parse、認証、Guard と Use-case の呼び出し、response への変換を受け持つ。SPA の handler は repository の port を import せず、guard の値を use-case か読み出しの関数に渡す (`handlers/__tests__/no-transport-tx.test.ts`)。SPA が呼ぶ API は契約 (`src/<domain>/*-contract.ts`) を `src/handlers/*-http-api.ts` で実装し、`mountSpaApi` で載せる。それ以外の Effect program は `runRoute` / `runMiddleware` / `runRpc` の adapter で走らせ、failure と defect を client-facing の応答 (`httpApiStatus` を持つ失敗の class から HTTP / Connect へ) に変換するのは adapter だけである。policy 述語、repository への直接 write、transaction は持たない。
- **Guard** (`membership/guard/`、`membership/policy.ts`): Hono に依存しない、操作単位の認可。
- **Use-case** (`account/`、`company/`、`invitation/`、`membership/`、`mfa/`): 業務手続、transaction、audit、不変条件、TOCTOU の再検証を受け持つ。
- Guard と Use-case の失敗は failure class で表し、status は class の `httpApiStatus` にだけ書く。どの domain にも属さない失敗 (`Unauthorized`・`Forbidden`・`NotFound`・`InvalidArgument`・`RateLimited`) は `src/failures.ts` に、domain の不変条件が破れた失敗はその domain の `errors.ts` に置く。ほかの domain が同じ失敗を返す時は、その `errors.ts` から import する (例: `membership/errors.ts` の `LastOwner`)。
- **Repository** (`db/repositories/`): query を提供し、業務判断を持たない。境界と例外 path は [`db/CLAUDE.md`](../db/CLAUDE.md) が定義元。
- domain が肥大化したら、技術分類ではなく操作名で下位ディレクトリを作る。`services/` や `utils/` のような、無関係な実装の寄せ集めを作らない。
- web から `@core` として参照される module は、browser-safe な依存だけを持つ。

## Effect様式

- Effect の書き方は root の [`CLAUDE.md`](../CLAUDE.md#effect) の通り `node_modules/effect/AGENTS.md` に従う。以下は配置と依存の規則だけを定める。
- Guard と Use-case は、依存を ports の service から `yield*` で取る。
- 各 domain は `ports.ts` に Repository の Effect 面 (`Context.Service`、型は `LiftedModule<typeof repo>`) を、`wiring.ts` に production の結線 (`liftAll(repo)`) を置く。port の method 名は repository の関数名と同じにする。同期 helper (`generate*`) は `liftAll` の対象外なので、必要な側が直接 import する。
- Repository 以外の port は、Layer で差し替えた時に何かを隠せる場合だけ置く。既存の service (`TtlStore` / `EmailSender` など) を使う関数は use-case から直接呼び、テストはその service の Layer を差し替えて、起きた結果 (計数、送信) を観測する。
- transaction は `Transaction.run` で取る。tx 内の failure と defect は常に rollback され、tx 後の副作用は `tapError` / `catchTag` で tx の外に置くか、tx の中から `afterCommit` で commit 後に登録する (例: `account/delete-account.ts` の session 削除)。
- 時刻は `Clock.currentTimeMillis`、ID は `IdGenerator`、better-auth API は `AuthApi`、TTL store は `TtlStore`、Sentry は `SentryService`、メールは `EmailSender`、fire-and-forget は `Background.run` を使う (渡す effect の失敗は渡す前に catch する)。
- サードパーティ境界の失敗は `errors.ts` の `DbError` / `AuthApiError` / `TtlStoreError` / `EmailError` (`cause: unknown`) で表し、producer は `tryDb` / `tryAuthApi` / `tryTtlStore` / `tryEmail` だけを使う。better-auth が session を受け付けなかった結果は境界の失敗ではないので、`AuthApi` が `SessionRejected` で返し、呼び手が写像する (activate / disable は `Unauthorized`)。
- `auth.ts` から辿れる module は `runtime.ts` を import せず、`initAuth(runtime, ttlStorage)` で受け取った runtime を使う (import の循環は fallow の `circular-dependency` が止める)。
- 副作用の置き場は「Layer で差し替えられるか」で決める。差し替えられる副作用 (`AuthApi` / `TtlStore` などの service) は program に置く。runtime が所有しない object (`ctx`、`Response`、`process.env`、`throw`) への副作用は、`runPromise` を呼ぶ adapter (`runRoute` / `runMiddleware` / `runRpc`、better-auth の hook) が行う。program はそれを closure で受け取らず、「何をすべきか」を直和型の値で返す (例: `src/auth-plugins/mfa-challenge.ts` の `ChallengeDecision`)。program の入力に `() => void` が混ざり、テストが呼び出し順を recorder で assert し始めたら、この境界が崩れている。HttpApi では handler の外で応答が作られるので、better-auth の Set-Cookie は `HttpEffect.appendPreResponseHandler` で足してよい (`request-http-api.ts` の `forwardSetCookies`)。`HttpApiSchema.WithHeaders` は複数の Set-Cookie を 1 本に連結するので使わない。
- 以上の境界は `src/__tests__/effect-boundary.test.ts` と `src/handlers/__tests__/no-transport-tx.test.ts` が固定する。

## test

- domain のテストは `<domain>/__tests__/` に、Transport のテストは `handlers/__tests__/` / `rpc/__tests__/` に、複数 domain にまたがる invariant は `src/__tests__/` に置く。
- DB に接触するテストは `TestDb` service を `yield*` し、`@/db/*` を runtime import しない (型 import は可)。テスト本体は `src/__tests__/live-runner.ts` の `dbTest(prefix)` が返す `run` に渡す 1 つの `Effect.gen` にし (後片付けは同じく返る `cleanup`)、失敗は `Effect.flip` / `Effect.exit` で failure class として観測する。DB への接触は fixture の setup と事後状態の観測に限り、production 境界の例外の根拠にしない。
- `@core` の公開面を変えたら `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。workerd 固有の挙動は local のテストで完了扱いにせず、manual regression か `wrangler dev --remote` で確認する。

## 静的な検査

他の CLAUDE.md や ADR が path で名指さない、source を走査する検査は、守る規則とともにここに書く。

- `__tests__/source-scan.test.ts`: 走査の module が、実行時に読み込まれる import だけを返すこと
- `__tests__/default-company-contract.test.ts`: 現在の事業所を書き換える経路のすべてに、契約の scenario があること
- `__tests__/e2e-setup.test.ts`: e2e の起動 script の MFA の鍵と、test の既定の鍵が同じであること
- `__tests__/request-context.test.ts`: `AUTH_TRUSTED_PROXY_HOPS` を読むのが request-context だけであること
- `../testing/__tests__/sentry.test.ts`: Sentry の SDK を import するのが runtime ごとの初期化 file と worker.ts だけであること
- `__tests__/no-environment-branch.test.ts`: `src/` で `APP_ENV` を読むのが、Sentry の環境名を決める `src/worker.ts` だけであることと、`web/src` が vite の build の mode (`import.meta.env.MODE` など) を読まないこと (本番の code は自分が本番かどうかを知らない)
- `__tests__/non-production-wrangler-config.test.ts`: 本番以外の worker の config (`testing/wrangler.jsonc`) が本番の name・route・Hyperdrive・vars を持たないこと
- `__tests__/testing-server-dependencies.test.ts`: 本番以外の server の entry (`testing/worker.ts`・`testing/server.ts`) から辿れる外部 package が dependencies だけであること (画面は web の build で bundle する)
- `__tests__/service-key.test.ts`: service key の検証が `verifyServiceKey` の 1 か所にあること
- `__tests__/url-allowlist-production.test.ts`: 本番の redirect 先の定数 (`src/redirect-hosts.ts`) が https の本番の host だけを許すこと。`bun test` は preload で本番以外の値に差し替えるので、preload の無い子 process で読む
- `__tests__/wrangler-dev-env.test.ts`: `scripts/wrangler-dev.sh` が上書きする env と、`wrangler.jsonc`・`testing/wrangler.jsonc` の vars の key が一致すること
- `account/__tests__/containment.test.ts`: 退会の判定と、commit 後の session 削除の呼び手が 1 つであること
- `auth-plugins/__tests__/containment.test.ts`: better-auth の hook の判定が auth-plugins に閉じること
- `email/__tests__/containment.test.ts`: メールの表示名が `DisplayText` を通り、template の依存と style の置き場が決まっていること
- `health/__tests__/containment.test.ts`: `/health` の probe の呼び手が 1 つで、TTL store の ping が再試行しないこと
- `membership/__tests__/containment.test.ts`: guard を通った印 (`Verified`) を付けられるのが guard だけであること
- `membership/__tests__/no-hono-import.test.ts`: Guard 層が hono を import しないこと
- `mfa/__tests__/containment.test.ts`: ログインの経路が import する MFA の module と、MFA の秘密の値の読み手が決まっていること
- `mfa/__tests__/policy.test.ts`: `mfa/policy.ts` が他の module を import しないこと

## gotcha

- segment 数が同じ Hono route では、static route を parameter route より先に登録する。
- workerd では request をまたいで I/O resource を再利用しない (ADR-0011)。
