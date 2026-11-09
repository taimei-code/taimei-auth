# ADR-0025: web の domain の境界を TypeScript の project references で型にする

## Status

Accepted (2026-11-09)。判断主体は maintainer。実装は taimei-code/taimei-auth#403 (親 #381)。[ADR-0015](./0015-web-domain-first-directory-structure.md) の「ドメイン間 import はファイルパス単位の allowlist で検査する」を置き換える。

## Context

ADR-0015 は web の domain をまたぐ import を、import する domain と相手の file の組の allowlist で検査していた。検査は source を走査する test だったので、違反は `bun test` を流すまで分からなかった。#403 ではこの規則を型にする (違反を書くと typecheck が落ちる) ことにした。

TypeScript の project references で確かめた振る舞いは次のとおりである (TypeScript 7.0.2)。

- 参照していない project の file を import すると TS6307 で落ちる
- 参照は推移的に通る。A が B を参照し、B が C を参照すると、A は C の file を import できる
- 参照の循環は `tsc -b` で TS6202 になる
- 参照される project は emit を止められない (`noEmit` は TS6310)
- domain の dir に `tsconfig.json` を置くと、bun の module の解決が変わり、`bun test` が落ちる

## Decision

1. web の domain ごとに、domain の直下 (`web/domain-projects/<domain>.json`) と、page と test (`<domain>.pages.json`) の 2 つの project を置く。`shared`・`app`・web が使う `@core` の file (`core.json`) は 1 つずつにする。`index.json` が全体を束ね、`bun run typecheck` が `tsc -b` で build する
2. domain をまたぐ import は、その domain の project の `references` から (推移的に) 届く domain だけに許す。粒度は domain であり、相手の file までは絞らない
3. page の project を参照するのは `app` と、同じ domain の page と test の project だけである。`shared` は `core` のほかを参照しない
4. 規則「domain の import は循環しない」は「domain の project の参照は循環しない」と読む。page から直下への参照は module の循環を作らないので、page を含めた domain の単位の循環は見ない
5. 設定は `tsconfig.json` の名前にせず `web/domain-projects/` に集め、`tsc -b` だけが読む。`web/tsconfig.json` (Effect の language service の診断を含む型検査、lint、エディタが読む) は変えない。宣言の出力は `node_modules/.cache/web-domain-projects/` に出す

## Considered Options

| 案 | 選ばなかった理由 |
|---|---|
| 今の file の粒度の allowlist を test で続ける | 違反が型で落ちない |
| domain ごとに公開の project を分け、相手の file を絞る | 公開する file が同じ domain の file を import すると、その file も公開の側に入るか参照で通るので、絞れるのは auth の 2 file と account の 3 file だけだった。domain ごとに project が 1 つ増え、同じ file の一覧を 2 つの設定に書く |
| domain の dir に `tsconfig.json` を置く | `bun test` の解決が変わって落ちる。vite・lint・エディタも最寄りの `tsconfig.json` を読む |
| domain ごとに 1 つの project (page を分けない) | 参照した domain の page も import できるので、「他の domain の page は app だけ」を型で守れない |

## Consequences

- 参照から届く domain の file なら、どの file でも import できる (例: account から `mfa/copy-result.ts`)。ADR-0015 より緩い
- domain の依存を足すときは、その domain の project の `references` を足す。足さずに import すると TS6307 になる
- 参照される project は宣言 (`.d.ts`) を出すので、export の推論された型が宣言に書けない時 (TS2742 など) は、`web/tsconfig.json` の検査が通っても `tsc -b` だけが落ちる。export に型の注記を書いて直す
- web が使う `@core` の module が新しい file を import すると、`core.json` の `files` に足すまで TS6307 になる
- `bun run typecheck` は `tsc -b` の分だけ長くなる (出力の cache が無いとき約 1.2 秒。全体は 1.8 秒から 3.0 秒)
- 型で守るようになった検査は `src/__tests__/web-domain-structure.test.ts` から消した。barrel・`lib`/`components`・`pages` の置き場・`@core` の specifier と同じ path の file を web に置かないこと・`web/src` 直下の file の検査は残る
