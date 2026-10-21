# ADR-0020: consumer の試験の環境を、SDK に同梱した compose の断片と digest で固定した private の image で配る

## Status

Accepted (2026-10-19)。判断主体は maintainer。実装は taimei-code/taimei-auth#285 の sub-issue に分けて入れる。この ADR は ADR-0014 の前提のうち「consumer は taimei-auth の Dockerfile を build する」を置き換える (ADR-0014 の Status に書いた)。

関連: ADR-0014 (Docker の stage と既定 target)、GLOSSARY.md の **試験 API**。

## Context

consumer app の e2e と手元の確認 (以下、試験の環境) は、taimei-auth の内部を自分で持っていた。

- 起動: submodule に固定した taimei-auth を Dockerfile の dev target で build し、migrate の command と内部の環境変数名を consumer の compose に書く
- 試験の利用者と事業所: consumer が taimei-auth の表の写しを持ち、行を直接 insert する
- ログイン: Better Auth の endpoint を呼び、verification の保存形式から token を読む

このため taimei-auth の内部を変えると consumer の試験の環境が動かなくなった。版の固定も consumer の root の SDK、e2e の SDK、submodule の 3 か所に分かれていた。root の CLAUDE.md は consumer 向けの機能を SDK か公開の endpoint の interface として先に設計し、identity DB を分離する時に consumer 側の変更を版の更新だけにすることを求めている。

試験の環境では、資格情報なしにログインした利用者を作る経路が要る。この経路が本番に出ると、誰でも任意の利用者としてログインできる。

## Decision

1. **起動は SDK に同梱した compose の断片で配る**。断片は `@taimei-code/auth-client` の package に入り、consumer の compose が `include:` する。断片は試験用の image と Postgres を起動し、migrate のあとに試験用の entry `testing/server.ts` を動かす
2. **試験用の image は private の GHCR に置き、SDK と同じ版で出して digest で固定する**。publish の workflow が image を build して push し、その digest を断片に埋めてから npm に publish する。consumer は image を build せず、公開した digest を pull する。consumer が固定する版は root の SDK の 1 か所になる
3. **断片の変数名 (`TAIMEI_AUTH_*`) と service 名 `taimei-auth` は、consumer が依存する公開の契約とする**。内部の環境変数名 (`AUTH_SERVICE_URL` など) と `DATABASE_URL` は断片の中で対応させ、consumer には書かせない
4. **試験の利用者は試験 API と SDK の client で作る**。consumer は `@taimei-code/auth-client/testing` の `createTestingClient(authBaseUrl).createSignedInUser(...)` を呼び、返る `loginUrl` を browser で開いてログインする。`loginUrl` は本物の Magic Link で、試験用の entry だけが Magic Link の URL を記録する `EmailSender` を使う。利用者は `AuthApi.createUser` で作り、事業所と所属は既存の use-case で作る (2026-10-20 改訂: OWNER の所属は事業所の作成で、ADMIN と MEMBER の所属は招待と受諾で作る。記録する `EmailSender` は招待のメールも記録し、試験 API は記録のうち戻り先が `returnTo` の送信の URL を `loginUrl` として返す)。試験の利用者の現在の事業所も、同じ client の `setCurrentCompany(...)` で既存の切り替えの use-case を通して切り替える
5. **試験 API を本番に出さない守りを 3 段にする**。どの段も単独で、試験 API が本番に出ることを止める
   - 型の境界: 試験のコードを `src/` の外の `testing/` に置く。root の `tsconfig.json` は composite で `testing/` を含まないので、`src/` から `testing/` を import すると typecheck が TS6307 で落ちる。`testing/` は `testing/tsconfig.json` で typecheck する (`scripts/typecheck.sh`)
   - 本番の bundle の検査: `deploy.yml` は upload の前に本番の bundle を `scripts/check-production-bundle.sh` で検査し、試験 API の path があれば deploy を止める
   - 起動の判定: `testing/server.ts` は boot の前に `APP_ENV === "test"` を確かめ、違えば exit 1 する

## 採らなかった案

- **submodule に置いた断片を `include:` する**: 起動の手順は consumer から消えるが、版の固定が SDK と submodule に分かれたまま残り、taimei-auth の更新に consumer の手順が 2 つ要る
- **本番のコードからの import を lint (biome の `noRestrictedImports`) で禁じる**: 呼び出し箇所に `biome-ignore` を 1 行書けば越えられ、その directive は repo で許されている。型の境界は `tsconfig.json` そのものを書き換えないと越えられない
- **現在の事業所の切り替えに、本番の `/api/account/current-company` を consumer の試験から呼ぶ**: SPA のための endpoint が consumer の依存する公開の契約になり、SPA の都合で変えられなくなる。切り替えを試験 API に置けば、本番の公開面は増えない
- **試験用の鍵や opt-in の環境変数で、本番の app の中の試験 API を開く**: 鍵は `APP_ENV=production` でも鍵があれば開く。環境変数は設定を誤ると開き、試験のコードが本番の bundle に入る。entry を分ければ、本番の artifact に試験のコードが入らない

## Consequences

- taimei-auth の更新に consumer が追従する手順は、SDK の版上げ 1 つになる (Dependabot の PR 1 本)
- 断片の変数名、service 名、compose の project の `default` network、`node_modules` からの `include:` が公開の契約になる。変えると consumer の compose が動かなくなるので、SDK の版の扱いを決めてから変える
- consumer の CI は断片を `include:` する前に root の SDK を install し、private の image を pull するために `docker login ghcr.io` を行う
- ADR-0014 の位置契約 (既定 target は dev) は残る (理由は ADR-0014 の Status)。変わるのは、consumer が Dockerfile を build するという前提だけである
- QA-MR-09 は consumer の compose からの build ではなく試験用の image の起動と試験 API のログインを確かめる手順になる
- 本番の `AuthApi` に、試験からしか呼ばない `createUser` が残る。本番の worker の bundle には method として入るので、型の境界では守れない。呼び手が試験の利用者を作る use-case だけであることを `testing/__tests__/containment.test.ts` が固定する
- 試験の利用者も、consumer が受け取る現在の事業所の契約 (VerifySession と GetSession) を満たす。`testing/` の中で現在の事業所を書き換える呼び手を `testing/__tests__/default-company-contract.test.ts` が固定する
- 資格情報なしの session 発行 (`AuthApi.issueSession`) の呼び手の固定 (`src/__tests__/effect-boundary.test.ts`) は変えない。試験 API は本物の Magic Link でログインさせる
- `bun test` の preload は `testing/__tests__/preload.ts` になり、taimei-auth 自身の試験の runtime も Magic Link の URL を記録する
