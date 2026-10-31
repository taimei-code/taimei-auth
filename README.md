# taimei-auth

taimei の認証サービス。構成は better-auth、Hono、drizzle (Postgres)、Cloudflare Workers / Durable Objects。

## ローカル起動

```bash
cp .env.example .env
docker compose up --build --watch
curl http://localhost:3100/health
```

http://auth.taimei-code.localhost:3100/ を開く (`*.localhost` は hosts に登録しなくても手元の機械に向く)。Magic Link と招待メールは実際には送信されず、URL がサーバの log に出る。

compose を使わず host で動かす場合は、e2e の起動 script (`e2e/start-server.sh`) と同じく、`.env` と、`docker-compose.yml` の `auth-service` の `environment` にある値 (`APP_ENV=development`・`AUTH_SERVICE_URL` など。`DATABASE_URL` は host の Postgres に向ける) を環境変数に export し、`bun run build:web:non-production` の後に `bash scripts/wrangler-dev.sh --config testing/wrangler.jsonc` で起動する。

GitHub OAuth、Resend、Vercel Blob の設定は省略できる。

## 変更フロー

- スキーマ: `db/schema.ts` を編集し、host で `bun run db:generate` を実行して、生成された `drizzle/*.sql` を commit する。次回の compose 起動時に `auth-migrate` が適用する
- Proto: `proto/` を編集し、host で `bun run generate` を実行して、`src/gen/` と `packages/auth-client/src/gen/` を両方 commit する。CI の Buf breaking check (`FILE` の規則) が rpc・service・field の削除と改名を見つけ、`scripts/check-sdk-breaking.sh` は SDK の major が上がっていない限りそれを通さない
- codegen は host の bun で実行する ([ADR-0014](./docs/adr/0014-docker-runner-dev-stage-separation.md))
- 型検査: `bun run typecheck` は `@effect/tsgo` に同梱の Effect の診断入りの `tsc` で検査する。`@effect/tsgo` は対応する `typescript` の版を狭く決めていて、合わない版では `UnsupportedTargetPackageVersionError` で止まる。`typescript` は `node_modules/@effect/tsgo/README.md` の Supported Package Versions に載る版へ、`@effect/tsgo` と一緒に上げる

## 運用

- 管理スクリプトは `management/` に置く (`docker compose run --rm auth-service bun run management/<script>.ts`)。MFA ロックアウトの救済は `disable-user-mfa.ts <userId>` が唯一の出口である ([ADR-0016](./docs/adr/0016-mfa-self-owned-totp.md))。管理スクリプトは起動の時に `AUTH_SECRET` を求める (`docker compose` の `auth-service` は開発用の値を渡す。`bun` で直接走らせる時は自分で渡す)。管理スクリプトは本番と同じく本物のメールを送るので、手元で走らせると、`AUTH_RESEND_KEY` が無ければ通知を送れず `notified: false` を返し、本物の鍵があれば本当に送る
- `MFA_CHALLENGE_ENABLED=false` で MFA チャレンジを緊急停止できる。明示的な `false` 以外の値では有効のまま。停止中は Sentry に 6 時間おきに warning が出る
- `AUTH_TRUSTED_PROXY_HOPS`: 本番以外の Bun の server (`testing/server.ts`) が client IP の導出に使う proxy の段数。必須で、未設定なら起動を拒否する。Workers は `cf-connecting-ip` を見るので不要 (`src/request-context.ts`)
- `MFA_TOTP_ENCRYPTION_KEYS`: `v1:<base64 32byte>[,v2:...]` の形式の鍵 ring で、最大の version が現行。ローテーションは新しい version を追記して deploy し、旧 version は該当する行が 0 になるまで残す ([ADR-0016](./docs/adr/0016-mfa-self-owned-totp.md))
- `AUTH_SERVICE_KEY` の rotation: [runbook](./docs/runbook/service-key-rotation.md)
- 手動回帰 QA: [docs/qa/manual-regression.md](./docs/qa/manual-regression.md)
