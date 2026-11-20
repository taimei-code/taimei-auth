# ADR-0030: フィーチャーフラグを Cloudflare Flagship に置き、評価を server の 1 か所に集める

## Status

Accepted (2026-11-19)。判断主体は maintainer。仕様の正本は taimei-code/taimei-auth#504 (親: #483、撤去: #505)。最初に使う flag はパスキーの公開である。

関連: ADR-0011 (Workers への移行と $0 の運用)、ADR-0021 (本番の code は環境を知らない)、ADR-0022 (staging と IaC)、ADR-0029 (パスキー)、GLOSSARY.md の **フィーチャーフラグ**。

## Context

運用者は deploy せずに、パスキー (ADR-0029) を全体に公開し、問題があれば全員に対して止めたい。ほかの機能では、一部の **事業所** へ先に出したいこともある。切り替えの条件の分岐を画面と server に散らすと、同じ判断が場所ごとにずれる。

Cloudflare Flagship (2026-11 時点で open beta、料金は未公表) は、Worker の binding から flag を評価できる。本番のアカウント (Workers Free) で、app の作成、ルールの評価、binding からの評価 (1 回 5〜12 ms)、無効化の反映 (約 2 秒) を確かめた (2026-11-16)。Flagship では、無効にした flag はルールに関係なく flag の既定の値を返し、存在しない key は呼び出し側の既定の値と `FLAG_NOT_FOUND` を返す。

## Decision

1. **フィーチャーフラグは Flagship に置く**。app と Worker の binding は alchemy で作る (本番と staging、`infra/alchemy.run.ts`)。flag とルールは dashboard で作り、alchemy では宣言しない。宣言すると、dashboard での切り替えが IaC の drift になる。変更の記録は Flagship の changelog に任せる
2. **評価は server の 1 か所に集める**。Flagship の binding に触れるのは `src/feature-flags.ts` だけで、そこが port `FeatureFlags` の実装と、機能の code が呼ぶ `enabled(flag, actor)` を持つ。機能の code は flag の名前と、ログインした user なら actor を渡し、真偽を受け取る (Ruby の Flipper の `enabled?` と同じ形)。flag の名前は、使う機能の file で `FeatureFlagRegistry` に型として登録する。flag を足しても `src/feature-flags.ts` は変えず、登録していない名前は型検査で落ちる。パスキーは actor を渡さない flag `passkey` の 1 つで、登録とログインを一緒に公開し、一緒に止める。ログイン前は actor を渡せないので、ログイン画面の入口とログインは全体に出すしかない。事業所ごとに絞れるのは登録だけになり、一部の事業所で先に試す役に立たないからである。判定は `src/passkey/availability.ts` にあり、WebAuthn の challenge を発行する関数と応答を検証する関数 (`src/passkey/webauthn.ts`) の先頭で呼ぶ。off なら challenge を発行も検証もせずに拒む。画面は flag を評価せず、server が返す判断に従う。consumer app (auth-client、RPC) には評価の結果を渡さない。これらの禁止は `lint/oxlint-plugin.mts` の表が止める
3. **評価に失敗したら off にする**。binding の呼び出しの失敗、2 秒の timeout、結果の `errorCode` (flag が無い、型が違う) は、warning の log を出して off にする。呼び出し側の既定の値は常に `false` を渡す
4. **flag の既定の値は常に off にし、ルールは 2 つの形に限る**。「事業所のリスト (`companyId`) → on」と「全体公開 (条件の無いルール) → on」で、両方を使う時は事業所のリストを先に置く。条件の無いルールはすべての評価に当たる。actor を渡す評価は `companyId` を渡し、渡さない評価は何も渡さないので、actor の無い評価が on になるのは全体公開の時だけである (Flipper の「全体 on」と「actor ごとの on」の区別)。既定の値を on にすると、無効にしても on のまま止まらない
5. **事業所は現在の事業所だけで決める**。所属先すべては見ない。現在の事業所が無い user は `companyId` を渡さず、事業所のルールに当たらない
6. **本番以外はメモリの実装を入口から渡す** (ADR-0021)。開発環境、`bun test`、e2e は `testing/feature-flags.ts` の実装を使い、「全体 on」「全体 off」「事業所 off」を作れる。staging は自分のアカウントの Flagship の app を使う
7. **Workers Free で動くことを前提にする**。Flagship が GA で有料になったら、この ADR を見直す

## Considered Options

| 案 | 選ばなかった理由 |
|---|---|
| 環境変数 (wrangler の vars) | 切り替えのたびに deploy が要る。事業所ごとの条件を値に詰めると、評価の code を自前で持つことになる |
| DB の表 | 運用者が切り替える画面か SQL の手順が要る。変更の記録も自前で持つことになる |
| Workers KV に条件を置く | 条件の評価を自前で持つ。KV の結果整合で、反映までの遅れの上限が読みにくい |
| 外部の feature flag の SaaS | 費用がかかり ($0 の運用、ADR-0011)、Worker から外部へ要求が 1 回増える |
| 画面でも flag を評価する | 画面と server の判断がずれる。画面は server の判断を表示するだけにする |

## Consequences

- 評価 1 回の遅延 (5〜12 ms、外れ値で約 140 ms) が、パスキーの登録、ログイン、一覧の要求と、共通ログイン画面がパスキーの入口を出すかを尋ねる要求に足される。1 要求で 1 回にまとめる
- deploy の後、dashboard で flag を作るまでは `FLAG_NOT_FOUND` で off になる。手順は `docs/runbook/production.md` の「フィーチャーフラグ」にある
- deploy と drift の token に Flagship の権限が要る
- dashboard の切り替えから反映まで、最大で約 30 秒の食い違いを許す
- フィーチャーフラグは期間限定で、全体に公開して落ち着いたら取り除く (#505)。仕組み (app、binding、評価を集めた `src/feature-flags.ts`、本番以外の実装、lint の行) は残し、ほかに使う flag が無い時に仕組みごと消すかは、その時に決める
