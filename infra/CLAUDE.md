# infra/ の書き方

`infra/` は staging と本番の資源を alchemy v2 で宣言する。stage の差は `infra/stages.ts` の表の値だけで表し、定義に stage の名前の分岐を書かない。本番の取り込みと IaC の外に残るものは [`docs/runbook/production.md`](../docs/runbook/production.md) にある。何を定義に載せ、何を載せないかの判断は [ADR-0022](../docs/adr/0022-staging-by-alchemy.md) にある。

## alchemy の API の確かめ方

- alchemy の版は root の `package.json` で固定している。API は、固定した版の source (`node_modules/alchemy/src`、`node_modules/@alchemy.run/cloudflare/src`) で確かめてから書く。v2 は Effect で資源を書く形で、学習データにある以前の alchemy とは API が違う。
- 概念、手順、どの資源を使うかは、https://alchemy.run/llms.txt から docs のページを引く。docs は最新版を説明するので、使う API が固定した版の source にあるかを確かめる。
- 定義は `bun run typecheck` が検査する。固定した版に無い API を書くと型エラーになる。

## drift の確かめ方

- 定義、state、cloud の差は、`.github/workflows/iac-drift.yml` が毎日 main の本番に向けて `infra/check-drift.ts` で確かめる。merge の前に手元の credential で走らせる手順は無く、PR の確認にも求めない。
- alchemy の版を上げて state の置き場の指定が変わっても、Worker 名は `infra/stages.ts` の `STATE_STORE_WORKER_NAME` を `src/__tests__/infra-stages.test.ts` が固定する。名前が変わらないことは test で確かめ、差は merge の後の deploy の log と次の `iac-drift.yml` で見る。
