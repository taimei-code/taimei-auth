# taimei-auth

Web UI、IdP、User、Account、Session DBを1サービスに同居させている。

将来identity DBを別processへ分離できるよう、consumer、server、DB、SDKの境界を維持する。

起動、compose、migration、Proto生成の手順は [README.md](./README.md) を参照する。

各scopeでは `CLAUDE.md` だけに本文を書き、同じ変更で同階層に相対symlink `AGENTS.md -> CLAUDE.md` を置く。

claude code以外の場合、subdirectoryのfileを扱う時は、そのfileまでのpath上にあるnested AGENTS.md をon-demandで読み、rootから順に追加適用し、path外のinstructionは読まない。

## 共通境界

- consumer appは `@taimei-code/auth-client` の公開APIとHTTPまたはConnect RPC endpointだけを利用し、`db/` をimportしない。
- consumer向け機能は先にSDKまたは公開endpointのinterfaceを設計し、identity DB分離時のconsumer変更をversion更新へ閉じる。

## リポジトリ共通規則

- `web/` のbuild設定にあるcontent、include、files系pathは、CWDではなく `import.meta.url` 起点で解決する。
- `workspace:*` 依存を追加または変更した時はDockerfileと [`ADR-0014`](./docs/adr/0014-docker-runner-dev-stage-separation.md) を確認する。
- canonical用語の確定または曖昧さ解消では [`CONTEXT.md`](./CONTEXT.md) を更新する。
- 巻き戻し困難、文脈なしでは不可解、実トレードオフの結果という3条件を満たす判断では [`docs/adr/`](./docs/adr/) にADRを追加する。
- 同じ設計判断の理由が3箇所以上へ散る場合は `CONTEXT.md` またはADRへ集約し、各所は参照だけを置く。
- 変更領域が [`docs/qa/manual-regression.md`](./docs/qa/manual-regression.md) の契機に一致する場合は、該当するQA-MRをマージ前に実施する。
- dependency更新で `minimumReleaseAge` の除外が必要な場合は [`ADR-0009`](./docs/adr/0009-supply-chain-hardening.md) に従う。
- TypeScript 7では新規tsconfigに必要な `types` を明示し、削除済みの `baseUrl` を使わない。
- Vite配下の型解決不能なside-effect importは `vite-env.d.ts` のreferenceで解決する。
