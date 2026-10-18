# taimei-auth

将来 identity DB を別 process へ分離できるよう、consumer、server、DB、SDK の境界を保つ。
各 scope の本文は `CLAUDE.md` に書き、同じ階層に相対 symlink `AGENTS.md -> CLAUDE.md` を同じ変更で置く。

## 共通境界

- consumer app が使うのは `@taimei-code/auth-client` の公開 API と、HTTP または Connect RPC の endpoint だけである。`db/` は import しない。
- consumer 向けの機能は、先に SDK または公開 endpoint の interface を設計する。identity DB を分離する時に consumer 側で必要になる変更を、version の更新だけに収めるためである。

## リポジトリ共通規則

- `web/` の build 設定にある content、include、files 系の path は `import.meta.url` を起点に解決する (CWD は root と `web/` の両方があり得る)。
- `workspace:*` 依存を変更した時は Dockerfile と [`ADR-0014`](./docs/adr/0014-docker-runner-dev-stage-separation.md) を確認する。
- canonical な用語の確定と曖昧さの解消は [`GLOSSARY.md`](./GLOSSARY.md) に書く。巻き戻しが難しい、文脈なしでは理解できない、実際のトレードオフの結果である、という 3 条件を満たす判断は [`docs/adr/`](./docs/adr/) に書く。同じ理由が 3 箇所以上に散ったらどちらかへ集約し、各所には参照だけを置く。
- 変更した領域が [`docs/qa/manual-regression.md`](./docs/qa/manual-regression.md) の契機に一致する場合は、該当する QA-MR をマージ前に実施する。
- 検査結果を呼び出し側が再判定している述語は、boolean を返すのをやめる。同じ式で narrowing するなら型述語にし (例: `src/mfa/policy.ts`)、結果を関数の境界の外へ渡すなら parse した値にする (例: `src/handlers/client-facing-error.ts` の `parseClientFacingError`)。再判定または cast が 1 行も消えないなら導入しない。
- `src` / `db` / `web` / `e2e` / `management` / `testing` の TS にはコメントを書かず、理由は名前、型、テスト名へ移す。書けるのは directive (`@ts-expect-error`、`biome-ignore`) だけである (`src/__tests__/no-code-comments.test.ts` が固定)。
- test 名は振る舞いの文で書き、設計書や issue の番号 (AC-001、QA-H-02、#52 など) を書かない。repo の外にしか定義が無く、番号から意味を引けないためである。書いてよい番号は repo の中に定義がある `QA-MR-*` (`docs/qa/manual-regression.md`) と `ADR-NNNN` だけである (`src/__tests__/test-names.test.ts` が固定)。
- 判定を 1 本の述語に集めた時は、所有 domain の `__tests__` にある `containment.test.ts` の静的 tripwire で、直接比較の再発を止める。構造や型で書けなくした時は、tripwire を置かない。
- source を走査する検査は `src/__tests__/source-scan.ts` で書き、守る規則を書いた CLAUDE.md (規則が無ければ `src/CLAUDE.md` の「静的な検査」節) か ADR に path で名指す (`src/__tests__/static-check-index.test.ts` が固定)。

## Effect

Effect の書き方は `node_modules/effect/AGENTS.md` に従い、各 scope の `CLAUDE.md` には書き方の規則を置かない。コードを書く前に AGENTS.md を最後まで読み、書く API に関わるリンク先を辿る (v4 の API は学習データの v3 と違う)。そこに無い API は `node_modules/effect/src` を検索する。
