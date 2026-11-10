# ADR-0027: 規則の正本を、違反した時の message と test 名に置く

## Status

Accepted (2026-11-10)。判断主体は maintainer。実装は taimei-code/taimei-auth#431。root の `CLAUDE.md` にあった「source を走査する検査は、守る規則を書いた CLAUDE.md か ADR に path で名指す」(#275) を置き換える。

## Context

規則は 2 か所にあった。毎回読む CLAUDE.md の文と、違反した時にだけ出る lint の message・test 名である。`static-check-index.test.ts` は走査の test の path を md に書くことを求めていた。見ていたのは path の文字列の有無だけで、文の中身は誰も見ていなかった。

CLAUDE.md 7 file (32,973 B) の文を 1 つずつ、止めている仕組みの code と突き合わせると、食い違いが 10 件あった。例: `src/CLAUDE.md` は「以上の境界を破る書き方は lint の表が止める」と書いていたが、12 の規則に行が無かった。`db/CLAUDE.md` は「User の削除と更新は repository を作らず」と書いていたが、`deleteUser` の repository があった。走査の test を足すたびに md は 1 行増え、写しは増える方向にしか動かなかった。

## Decision

1. 型・lint・test が止める規則は、CLAUDE.md に書かない。規則の文は、lint の行の message か test 名が持つ。違反した人はその場で規則と理由を読む
2. CLAUDE.md に残すのは、止める仕組みの無い規則 (判断と手順) と、定義元への参照だけである。理由と説明は ADR か GLOSSARY に置く
3. `static-check-index.test.ts` が次を固定する
   - CLAUDE.md は lint の rule 名 (`taimei/…`) と test file の path を書かない
   - CLAUDE.md の合計 byte は上限以下である。上限は、規則を仕組みにして文を消した時だけ下げる。上げるのは、止める仕組みの無い規則を足す時だけで、理由を PR に書く
   - lint の plugin が持つ rule と、`.oxlintrc.json` で `error` にした `taimei/*` の rule は同じである (行を足して有効にし忘れると落ちる)
   - 追跡している AGENTS.md はすべて symlink である
4. 見出しへの参照の検査 (CLAUDE.md の見出しを引く時は、実在の見出しを指す。規則の番号で引かない) は残す

## Considered Options

| 案 | 選ばなかった理由 |
|---|---|
| 今のまま (走査の test を md か ADR が名指す) | 写しが 10 件ずれていた。走査の test を足すたびに md が増える |
| 名指しを求め、さらに md の文と test 名の一致を見る | 文の一致は判定できない。md は増え続ける |

## Consequences

- 規則に着く経路が変わる。これまでは md の規則の文から検査を 1 回たどった。これからは、違反した時に出る message と test 名がそのまま規則である。違反する前に規則を知る手段は、lint の表 (`lint/oxlint-plugin.mts` の `ROWS`) と test 名を読むことである
- 走査の test を足す時に、規則の文を md に書くことを求める検査は無くなる。規則の文は test 名に書く (test 名の lint が、repo の外にしか定義の無い番号で済ませることを止める)
- #431 で入れなかった規則 (QA-MR の実施の強制、search の既定の値、program が副作用を closure で受け取らないこと、`Transaction.run` の中から送信しないこと、ほか) は md に残した。入れなかった理由は、副作用の 2 つは ADR-0017「副作用の置き場」に、ほかは #431 の PR に書いた
