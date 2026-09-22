# taimei-auth

taimei の認証サービス。構成は better-auth、Hono、drizzle (Postgres)、Cloudflare Workers / Durable Objects。

## ローカル起動

```bash
cp .env.example .env
echo "127.0.0.1 app.taimei-code.local auth.taimei-code.local" | sudo tee -a /etc/hosts
docker compose up --build --watch
curl http://localhost:3100/health
```

http://auth.taimei-code.local:3100/ を開く。Magic Link と招待メールは実際には送信されず、URL がサーバの log に出る。

compose を使わず host で動かす場合:

```bash
docker compose up auth-postgres -d
bun install && bun run db:migrate
bun run dev:web   # 別ターミナル
bun run dev       # localhost:3100
```

GitHub OAuth、Resend、Vercel Blob の設定は省略できる。

## 変更フロー

- スキーマ: `db/schema.ts` を編集し、host で `bun run db:generate` を実行して、生成された `drizzle/*.sql` を commit する。次回の compose 起動時に `auth-migrate` が適用する
- Proto: `proto/` を編集し、host で `bun run generate` を実行して、`src/gen/` と `packages/auth-client/src/gen/` を両方 commit する。CI の Buf breaking check に引っかかる変更には SDK の major bump が要る
- codegen は host の bun で実行する ([ADR-0014](./docs/adr/0014-docker-runner-dev-stage-separation.md))

## 運用

- 管理スクリプトは `management/` に置く (`docker compose run --rm auth-service bun run management/<script>.ts`)。MFA ロックアウトの救済は `disable-user-mfa.ts <userId>` が唯一の出口である ([ADR-0016](./docs/adr/0016-mfa-self-owned-totp.md))
- `MFA_CHALLENGE_ENABLED=false` で MFA チャレンジを緊急停止できる。明示的な `false` 以外の値では有効のまま。停止中は Sentry に 6 時間おきに warning が出る
- `AUTH_TRUSTED_PROXY_HOPS`: Bun で起動する時に client IP の導出に使う proxy の段数。production では必須で、未設定なら起動を拒否する。Workers は `cf-connecting-ip` を見るので不要 (`src/request-context.ts`)
- `MFA_TOTP_ENCRYPTION_KEYS`: `v1:<base64 32byte>[,v2:...]` の形式の鍵 ring で、最大の version が現行。ローテーションは新しい version を追記して deploy し、旧 version は該当する行が 0 になるまで残す ([ADR-0016](./docs/adr/0016-mfa-self-owned-totp.md))
- `AUTH_SERVICE_KEY` の rotation: [runbook](./docs/runbook/service-key-rotation.md)
- 手動回帰 QA: [docs/qa/manual-regression.md](./docs/qa/manual-regression.md)
