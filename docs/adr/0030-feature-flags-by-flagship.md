# ADR-0030: フィーチャーフラグを Cloudflare Flagship に置き、評価を server の 1 か所に集める

## Status

Accepted (2026-11-19)。判断主体は maintainer。仕様の正本は taimei-code/taimei-auth#504 (親: #483、撤去: #505)。最初に使う flag はパスキーの公開である。

関連: ADR-0011 (Workers への移行と $0 の運用)、ADR-0021 (本番の code は環境を知らない)、ADR-0022 (staging と IaC)、ADR-0029 (パスキー)、GLOSSARY.md の **フィーチャーフラグ**。

## Context

運用者は deploy せずに、パスキー (ADR-0029) を全体に公開し、問題があれば全員に対して止めたい。ほかの機能では、一部の **事業所** へ先に出したいこともある。切り替えの条件の分岐を画面と server に散らすと、同じ判断が場所ごとにずれる。

Cloudflare Flagship (2026-11 時点で open beta、料金は未公表) は、Worker の binding から flag を評価できる。本番のアカウント (Workers Free) で、app の作成、ルールの評価、binding からの評価 (1 回 5〜12 ms)、無効化の反映 (約 2 秒) を確かめた (2026-11-16)。Flagship では、無効にした flag はルールに関係なく flag の既定の値を返し、存在しない key は呼び出し側の既定の値と `FLAG_NOT_FOUND` を返す。

## Decision

1. **フィーチャーフラグは Flagship に置く**。app と Worker の binding は alchemy で作る (本番と staging、`infra/alchemy.run.ts`)。flag とルールは dashboard で作り、alchemy では宣言しない。宣言すると、dashboard での切り替えが IaC の drift になる。変更の記録は Flagship の changelog に任せる
2. **評価は server の 1 か所に集める**。Flagship の binding に触れるのは `src/feature-flags.ts` だけで、そこが port `FeatureFlags` の実装と、機能の code が呼ぶ `enabled(flag, actor)` を持つ。機能の code は flag の名前と、ログインした user なら actor を渡し、真偽を受け取る (Ruby の Flipper の `enabled?` と同じ形)。flag の名前は、使う機能の file で `FeatureFlagRegistry` に型として登録する。flag を足しても `src/feature-flags.ts` は変えず、登録していない名前は型検査で落ちる。本番以外の flag の一覧 (`testing/feature-flag-catalog.ts`) にも同じ flag と評価の対象を足し、足し忘れと取り違えは型検査で落ちる。登録の値には評価の対象を書く (`"everyone"` は actor を渡さない flag、`"companies"` は現在の事業所で決まる flag)。`enabled` を呼ぶ時に、`"everyone"` の flag に actor を渡すか、`"companies"` の flag に actor を渡さないと、型検査で落ちる。パスキーは actor を渡さない flag `passkey` の 1 つで、登録とログインを一緒に公開し、一緒に止める。ログイン前は actor を渡せないので、ログイン画面の入口とログインは全体に出すしかない。事業所ごとに絞れるのは登録だけになり、一部の事業所で先に試す役に立たないからである。判定は `src/passkey/availability.ts` にあり、WebAuthn の challenge を発行する関数と応答を検証する関数 (`src/passkey/webauthn.ts`) の先頭で呼ぶ。off なら challenge を発行も検証もせずに拒む。画面は flag を評価せず、server が返す判断に従う。consumer app (auth-client、RPC) には評価の結果を渡さない。これらの禁止は `lint/oxlint-plugin.mts` の表が止める
3. **評価に失敗したら off にする**。binding の呼び出しの失敗、2 秒の timeout、`FLAG_NOT_FOUND` 以外の結果の `errorCode` (型が違う、など) は、warning の log を出して off にする。flag が無い (`FLAG_NOT_FOUND`) のは失敗ではなく未公開として扱い、warning を出さずに off にする。flag は deploy の後に dashboard で作るので、作るまでの間は正常でも `FLAG_NOT_FOUND` が続き、本物の失敗の warning が埋もれる。code の側の名前の書き間違いは型検査で落ちる。dashboard の側の key の書き間違いと flag の削除も `FLAG_NOT_FOUND` になり、warning は出ない。これらは flag を作った後に、公開した機能が画面に出ることを確かめて見つける (`docs/runbook/production.md` の「フィーチャーフラグ」)。呼び出し側の既定の値は常に `false` を渡す。(2026-11-26 改訂、#609。それまでは flag が無い時も warning を出していた)
4. **flag の既定の値は常に off にし、ルールは 2 つの形に限る**。「事業所のリスト (`companyId`) → on」と「全体公開 (条件の無いルール) → on」で、両方を使う時は事業所のリストを先に置く。条件の無いルールはすべての評価に当たる。actor を渡す評価は `companyId` を渡し、渡さない評価は何も渡さないので、actor の無い評価が on になるのは全体公開の時だけである (Flipper の「全体 on」と「actor ごとの on」の区別)。既定の値を on にすると、無効にしても on のまま止まらない
5. **事業所は現在の事業所だけで決める**。所属先すべては見ない。現在の事業所が無い user は `companyId` を渡さず、事業所のルールに当たらない
6. **本番以外は、入口が Flagship の代わりの実装を渡すか、wrangler の手元の置き場を読むかを決める** (ADR-0021)。taimei-auth 自身の e2e と `bun test` は `testing/feature-flags.ts` の実装を使い、「全体 on」「全体 off」「事業所 off」を作れる。e2e の入口 `testing/worker.ts` は代わりの実装を渡す。代わりの実装は切り替えを memory にだけ持ち、作るたびに全体 on から始まる。e2e は試験 API で切り替え、e2e の開発者ホームは「フィーチャーフラグ」の link を出さない。開発者ホームにフィーチャーフラグのページは無い。試験用の image の入口 `testing/server.ts` は、binding を呼ばずに常に off を返す実装 (`featureFlagsAllOff`) を渡す。試験の環境では、flag が無い時と同じく、すべての flag が未公開になり、warning も出ない。公開済みで flag をまだ取り除いていない機能も未公開になり、flag を取り除いた版の SDK に上げると出る。公開済みの flag の一覧は持たない。試験の環境には試験 API の切り替えの route と、開発者ホームの「フィーチャーフラグ」の link が無い。全体 on のままにすると、本番で未公開の機能が consumer を起動しただけで使えるので、この案 (#597) は採らなかった。開発環境の入口 `testing/dev-worker.ts` は代わりの実装を渡さない。worker は本番と同じ評価の実装 (Decision 2〜4) で binding を読み、`wrangler dev` の下の binding は、wrangler の手元の置き場 (wrangler が手元に持つ flag の保存先。Local Explorer の画面の呼び名は local store) を指す。手元の置き場は空から始まり、flag が無い間は Decision 3 のとおり warning を出さずに off になる。開発者は Local Explorer (`http://localhost:3100/cdn-cgi/local/explorer/flagship/FLAGS`) で flag を作り、切り替える。Local Explorer は host 名が `localhost` か `127.0.0.1` の時だけ開き、開発環境のふだんの host 名では 403 になる。手元の置き場は compose の名前付き volume にあり、worker の読み直し、`docker compose restart auth-service`、image の作り直し、`docker compose down` と `up` の後も残り、`docker compose down -v` で開発環境の DB と一緒に消える。同じ volume に wrangler の Durable Object の状態 (session、試行回数の制限の計数) も置かれるので、これらも image の作り直しの後に残る。手元の置き場だけを空にするには、`docker compose down` の後に `docker volume rm taimei-auth_auth-wrangler-state` を流す (接頭辞は compose の project 名)。手元の置き場は DB とは別の volume にあるので、片方だけを消すと両者が揃わない。手元の置き場だけを消した時は session が消えてログインし直すだけで済むが、DB の volume だけを消すと、残った session が居ない利用者を指す。開発環境には試験 API の切り替えの route が無い。開発者ホームの「フィーチャーフラグ」の link は Local Explorer を指す。link の URL は開発者ホームを開いた要求の scheme と port をそのまま使い、host 名を `localhost` に替えて作る。手元の置き場を使う入口は、`docker-compose.yml` が起動する 1 つに限る。e2e は起動のたびに全体 on から始まる前提で作られており、空の手元の置き場を読むと公開済みの機能まで off になるためである。staging は自分のアカウントの Flagship の app を使う。(2026-11-27 改訂、#599。それまでは代わりの実装が置き場を受け取り、切り替えを本番以外の DB の表 `testing_feature_flag_rules` に残す置き場もあった。すでに作られた表は code では消さない。表は開発環境、試験の環境、staging の DB に使われないまま残る。2026-11-27 改訂、#598。それまでは e2e の開発者ホームに、フィーチャーフラグの状態を見て切り替えるページと、そこへの link があった。2026-11-27 改訂、#612。それまでは試験用の image も memory の置き場を渡し、起動のたびに全体 on から始まり、試験 API と開発者ホームのページで切り替えられた。2026-11-26 改訂、#596。それまでは開発環境の開発者ホームに link が無かった。2026-11-26 改訂、#595。それまでは container を作り直すと切り替えが消えていた。2026-11-26 改訂、#594。それまでは開発環境も代わりの実装を使い、切り替えを本番以外の DB の表に残していた。2026-11-23 の改訂 (#565) より前は、本番以外のすべての入口が memory の置き場を渡していた)
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
- deploy の後、dashboard で flag を作るまでは `FLAG_NOT_FOUND` で off になり、warning は出さない (Decision 3。2026-11-26 改訂、#609)。手順は `docs/runbook/production.md` の「フィーチャーフラグ」にある
- deploy と drift の token に Flagship の権限が要る
- dashboard の切り替えから反映まで、最大で約 30 秒の食い違いを許す
- Decision 6 の本番以外の実装を使う taimei-auth 自身の e2e は、試験 API で切り替える (Decision 6。2026-11-27 改訂、#598)。開発環境は開発者ホームの link から開く Local Explorer で切り替える (2026-11-26 改訂、#594、#596)。試験の環境は切り替えられない (Decision 6。2026-11-27 改訂、#612)。staging と本番は dashboard で切り替える (手順は `docs/runbook/production.md` の「フィーチャーフラグ」。#546)
- フィーチャーフラグは期間限定で、全体に公開して落ち着いたら取り除く (#505)。仕組み (app、binding、評価を集めた `src/feature-flags.ts`、本番以外の実装、lint の行) は残し、ほかに使う flag が無い時に仕組みごと消すかは、その時に決める
