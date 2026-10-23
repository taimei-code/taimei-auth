# e2e/ 実行と fixture の規則

## 実行

- repo root で `bun run test:e2e` を走らせる。1 つの spec だけなら `bun run test:e2e e2e/<name>.e2e.ts`。`helpers.ts` が `process.cwd()` から path を組むので、root 以外では動かない。
- 前提は、root の CLAUDE.md「検証」にある local の Postgres の用意と `.env` である。auth-service の container は要らない。
- `e2e/start-server.sh` が web の build、全 fixture の seed、本番以外の entry `testing/worker.ts` の wrangler dev (:3110) を行う。server の log は `e2e/.server.log` に出る。local で :3110 に server が既に動いていれば、Playwright はその server を使い、build と seed は走らない (`playwright.config.ts` の `reuseExistingServer`)。古い build や古い seed の行で spec が落ちる時は、その server を止めてから走らせ直す。
- spec は server の log と seed を共有するので、1 worker で順に走る (`playwright.config.ts`)。

## fixture

- spec は DB を import しない。行を作り直すのは `helpers.ts` の `reseedFixture` (子プロセスの `e2e/seed.ts`) だけである。spec の process に pg の Pool を開くと閉じる手段が無く、runner が止まらない。`fixture-names.ts` を `fixtures.ts` から分けているのはこのためである (spec からの DB の import は `biome.json` の e2e の override が止める)。
- 行を壊す spec は `fixture-names.ts` の `ConsumableFixture` に名前を足し、`beforeEach` で `reseedFixture` を呼ぶ。壊さない spec は全体の seed の行を使う。
- `fixtures.ts` は `DATABASE_URL` の host が local でなければ止まる (`db/testing/local-database.ts`)。

## 書き方

- file 名は `<name>.e2e.ts` にする。`.test.` や `.spec.` を含めると `bun test` が拾う (`src/__tests__/e2e-setup.test.ts`)。
- 画面は GLOSSARY の語で呼ぶ (例: 共通ログイン画面)。
- 送ったメールの URL は `helpers.ts` の `sentLinkAfter(email, 送る操作)` で、その操作より後に log に出た行から読む。同じ email の古い行を拾わないためである (server の log は spec と実行をまたいで残る)。
- SPA の API のモックは `contract-mock.ts` の `routeEndpoint(page, "<group>.<endpoint>", handler)` で張る。path と method を契約から取り、同じ path の別の method の request は素通しにする。
- 契約で宣言した失敗の応答は `contract-mock.ts` の `declaredFailure` で作る。契約を変えるとモックを作る所で throw するので、契約とずれたモックに気づかないことはない。契約に無い応答 (body の無い 500、遅延、`abort`) は応答だけを手で書く。
- `@/` は root の tsconfig では repo root を、web の tsconfig では `web/src` を指す。`e2e/` の `@/db/...` を web にそのまま写さない。
