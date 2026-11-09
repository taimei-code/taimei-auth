# ADR-0026: 1 file の source の形で決まる禁止を、lint の表に書く

## Status

Accepted (2026-11-09)。判断主体は maintainer。実装は taimei-code/taimei-auth#398 (親 #381)。root の `CLAUDE.md` にあった、判定を 1 本の述語に集めた時は `containment.test.ts` の静的 tripwire で止める、という規則を置き換える。

## Context

「X を書くのは file F だけ」「この dir は Y を import しない」のような禁止を、source を `grep` で走査する test (`src/__tests__/source-scan.ts`) で守っていた。違反は `bun test` を流すまで分からず、エディタには出ない。規則は書けない形 (構造・型) で守り、守れなければ lint、それも無理なら test で守る、という優先順に合わせて、lint で同じ違反を同じ path で止められる検査を lint に移す。

oxlint 1.90.0 で確かめた振る舞いは次のとおりである。

- `overrides` の 2 つが同じ file に当たり、同じ rule を設定すると、後の設定が前の設定を置き換える (merge しない)
- `overrides` は `extends` を受け付けない
- JS plugin の rule は `context.filename` と `context.sourceCode.getAllComments()` を読める

## Decision

1. 移す単位は `test()` ごとで、基準は「lint の rule が、同じ違反を同じ path で止められるか」である。「X は F だけ」は「F の外で X を書かない」として移し、F で使っていることの確認 (存在) は落とす。存在、件数、2 つの走査の集合の一致、file をまたぐ事実、実行時の値を見る検査は test に残す
2. 移した禁止は `lint/oxlint-plugin.mts` の表 (`ROWS`) に書く。1 行が 1 つの rule (`taimei/<name>`) で、当てる path (`within`)、許す file (`allowedIn`)、見る形 (matcher) と、守る規則の文 (message) を持つ。rule は `.oxlintrc.json` の root の `rules` で有効にし、範囲は行が決める。path は lint する file から上へ辿って最初の `.oxlintrc.json` の dir からの相対 path で比べる
3. 新しい禁止は表に書く。`.oxlintrc.json` の `no-restricted-imports` は今ある group の禁止だけにし、範囲の重なる override を足さない
4. 既存の lint が同じ違反を同じ path で止めている検査は、行を足さず test だけを消す

## Considered Options

| 案 | 選ばなかった理由 |
|---|---|
| plugin の rule を 1 件ずつ書き、範囲と例外は `.oxlintrc.json` の override に書く | 規則と範囲が 2 つの file に分かれる。rule ごとに override を分け忘れると、後勝ちの置き換えで禁止が消える |
| 組み込みの `no-restricted-imports`・`no-restricted-properties` を override に足す | 範囲の重なる override に足すと既存の禁止が置き換わる。避けるには既存の禁止の一覧を写すことになり、写しの同期を忘れる余地が残る |
| test に残す | 違反が `bun test` まで分からない。lint で守れる規則を test で守ることになり、上の優先順に反する |

## Consequences

- lint の rule は `oxlint-disable-next-line` で黙らせられる。test は黙らせられない。directive は書いた人が意図して書くもので diff に残るので、受け入れる
- 表の行の fixture (違反と許す例) は `src/__tests__/oxlint-rules.test.ts` に置く。#398 で移した行の fixture は、受け入れテスト `acceptance/lint-rules-members-switch.test.ts` にある
- 移せなかった検査の一覧と理由は #398 の PR に書いた
- #398 より前からある taimei の rule 6 本 (`no-effect-run-in-web` ほか) は、範囲を `.oxlintrc.json` の override で決めたままにしている。表の行に移せば範囲の決め方が 1 つになる
