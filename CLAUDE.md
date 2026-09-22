# taimei-auth

将来identity DBを別processへ分離できるよう、consumer、server、DB、SDKの境界を維持する。
各scopeの本文は `CLAUDE.md` に書き、同階層に相対symlink `AGENTS.md -> CLAUDE.md` を同じ変更で置く。

## 共通境界

- consumer appは `@taimei-code/auth-client` の公開APIとHTTPまたはConnect RPC endpointだけを利用し、`db/` をimportしない。
- consumer向け機能は先にSDKまたは公開endpointのinterfaceを設計し、identity DB分離時のconsumer変更をversion更新へ閉じる。

## リポジトリ共通規則

- `web/` のbuild設定にあるcontent、include、files系pathは `import.meta.url` 起点で解決する (CWDはrootと `web/` の両方があり得る)。
- `workspace:*` 依存を変更した時はDockerfileと [`ADR-0014`](./docs/adr/0014-docker-runner-dev-stage-separation.md) を確認する。
- canonical用語の確定と曖昧さ解消は [`CONTEXT.md`](./CONTEXT.md) に書く。巻き戻し困難、文脈なしでは不可解、実トレードオフの結果という3条件を満たす判断は [`docs/adr/`](./docs/adr/) に書く。同じ理由が3箇所以上へ散ったらどちらかへ集約し、各所は参照だけを置く。
- 変更領域が [`docs/qa/manual-regression.md`](./docs/qa/manual-regression.md) の契機に一致する場合は、該当するQA-MRをマージ前に実施する。
- 検査結果を呼び出し側が再判定している述語はbooleanをやめる。同じ式でnarrowingするなら型述語 (例: `src/mfa/policy.ts`)、結果を関数境界の外へ渡すならparseした値 (例: `src/handlers/client-facing-error.ts` の `parseClientFacingError`)。再判定またはcastが1行も消えないなら導入しない。
- 判定を述語1本に集めた時は、所有domainの `__tests__/containment.test.ts` の静的tripwireで直接比較の再発を止める。

## Effect

Effectのコードを書く前に `node_modules/effect/AGENTS.md` を**最後まで**読み、リンク先も辿る。そこに無いAPIは `node_modules/effect/src` を検索する。
