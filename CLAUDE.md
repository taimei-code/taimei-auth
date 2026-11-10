# taimei-auth

consumer、server、DB、SDK の境界と理由は [`ADR-0006`](./docs/adr/0006-sdk-encapsulation.md) と [`ADR-0021`](./docs/adr/0021-production-code-knows-no-environment.md) が定義元である。型・lint・test が止める規則は、ここにも各 scope の `CLAUDE.md` にも書かない (違反した時の message と test 名が規則を説明する。ADR-0027)。

## 共通境界

- consumer 向けの機能は、先に SDK または公開 endpoint の interface を設計する。

## リポジトリ共通規則

- `web/` の build 設定にある content、include、files 系の path は `import.meta.url` を起点に解決する (CWD は root と `web/` の両方があり得る)。
- canonical な用語の確定と曖昧さの解消は [`GLOSSARY.md`](./GLOSSARY.md) に書く。巻き戻しが難しい、文脈なしでは理解できない、実際のトレードオフの結果である、という 3 条件を満たす判断は [`docs/adr/`](./docs/adr/) に書く。同じ理由が 3 箇所以上に散ったらどちらかへ集約し、各所には参照だけを置く。
- 変更した領域が [`docs/qa/manual-regression.md`](./docs/qa/manual-regression.md) の契機に一致する場合は、該当する QA-MR をマージ前に実施する。
- 検査結果を呼び出し側が再判定している述語は、boolean を返すのをやめる。同じ式で narrowing するなら型述語にし (例: `src/mfa/policy.ts`)、結果を関数の境界の外へ渡すなら parse した値にする (例: `parseClientFacingError`)。再判定または cast が 1 行も消えないなら導入しない。
- 判定を 1 本の述語に集めた時は、`lint/oxlint-plugin.mts` の表に、ほかの file での直接の比較や呼び出しを止める行を足す。構造や型で書けなくした時は、行を置かない。

## 検証

- 変更を終える前に `bun run check` を走らせる。画面か e2e の対象を触ったら `bun run test:e2e` も走らせる。

## Effect

コードを書く前に `node_modules/effect/AGENTS.md` を最後まで読み、書く API に関わるリンク先を辿る (v4 の API は学習データの v3 と違う)。そこに無い API は `node_modules/effect/src` を検索する。
