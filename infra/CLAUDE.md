# infra/ の書き方

何を定義に載せるかは [ADR-0022](../docs/adr/0022-staging-by-alchemy.md)、本番の運用は [`docs/runbook/production.md`](../docs/runbook/production.md) にある。

- stage の差は `infra/stages.ts` の表の値だけで表し、定義に stage の名前の分岐を書かない。
- alchemy v2 は Effect で資源を書く形で、学習データにある以前の alchemy と API が違う。API は固定した版の source (`node_modules/alchemy/src`、`node_modules/@alchemy.run/cloudflare/src`) で確かめ、概念と手順は https://alchemy.run/llms.txt から引く。
