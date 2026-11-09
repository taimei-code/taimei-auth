# ADR-0024: メールの本文を決まった部品のデータで書き、1 つの関数で HTML と text にする

## Status

Accepted (2026-11-09)。判断主体は maintainer。実装は taimei-code/taimei-auth#419 (親 #381)。対象は server が送るメール (`src/email/`) だけで、画面 (web) の書き方は [ADR-0023](./0023-web-foldkit.md) が決める。

## Context

#396 で web から React を外した後も、メールの template だけが React と react-email で書かれていた。メールに求めるのは、決まった文面とボタンと link を、どのメール client でも崩れずに出すことだけで、画面のような操作や状態は無い。

書き方を選ぶ基準は 2 つである。誰が書いても同じ見た目の code になること (ADR-0023 と同じ基準) と、workerd の起動時の CPU を増やさないこと ([ADR-0011](./0011-cloudflare-workers-migration.md) と #238 で、メールの依存が起動時の JS の大半を占めた)。

## Decision

1. メールの本文は、`src/email/layout.ts` が定める決まった部品 (段落・ボタン・URL の段落・強調・link・改行) と、見出し・導入・本文・末尾の欄を持つデータで書く。template は部品と style の名前を選ぶだけで、markup と CSS を書く場所を持たない。
2. 1 つの関数が同じデータから HTML と plain text の両方を作る。文字と属性の値は、この関数が必ず escape する。escape しない HTML を渡す部品は作らない。
3. 画面と違い、メールに Foldkit は使わない。メールには view の状態も Message も無く、状態と処理を置く場所が決まるという Foldkit の利点は、メールでは役に立たない。
4. 件名・HTML・text は移す前の react-email の出力と同じにした。HTML は、React が文字の境目に差し込む表示されない comment (`<!-- -->` など) だけを除けば byte で同じである。区切り線の後の著作権表示、Outlook 向けの comment、text の見出しの大文字化と連続した空白を 1 つにする処理も、移す前の出力に合わせた。比べる試験は `acceptance/email-without-react.test.ts`。著作権表示の年は送った時刻の UTC の年にした (本番の workerd は前から UTC で動くので、本番の表示は変わらない)

## Considered Options

| 案 | 選ばなかった理由 |
|---|---|
| react-email のまま | React を repo に残す。起動時に react-dom/server と html-to-text と prettier を読む |
| `hono/html` の tagged template と、text 用に html-to-text | template ごとに markup を自由に書ける。`raw()` で escape を素通りできる。`'` の escape が React と違い (`&#39;`)、出力が変わる。html-to-text が依存に残る |
| Foldkit の `renderToString` (`foldkit/experimental/server`) | experimental である。`foldkit` は web 専用の依存で、server で使うには依存の分類を変える。react-email と同じ markup を手で書くことになり、text は別に作る必要がある |
| mjml などのメール専用の library | 依存と起動時の CPU が増える |

## Consequences

- `react`・`react-dom`・`@types/react`・`@react-email/*` を repo の依存から外した。`wrangler deploy --dry-run` の `worker.js` は 7,557,558 B から 6,328,429 B に減った。
- 部品を足す時は、`layout.ts` の HTML と text の両方の変換に足す。switch が部品を網羅していないと型検査が失敗する。
- メールの見た目を変える時は、移す前の出力と比べる試験 (`acceptance/email-without-react.test.ts`) の期待値の file (`acceptance/email-without-react/`) も、同じ変更で書き換える。
- link は react-email と同じく `target="_blank"` だけを付け、`rel` を付けない。行き先は自分の auth ホスト、`mailto:`、自社の security の page で、受け手はメール client で開く。
