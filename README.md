# taimei-auth

taimei の認証サービス。better-auth + Hono + drizzle (Postgres) + Cloudflare Workers / Durable Objects。

## ローカル起動

```bash
cp .env.example .env
echo "127.0.0.1 app.taimei-code.local auth.taimei-code.local" | sudo tee -a /etc/hosts
docker compose up --build --watch
curl http://localhost:3100/health
```

http://auth.taimei-code.local:3100/ を開く。Magic Link と招待メールは実送信されず、URL がサーバ log に出る。

compose を使わず host で動かす場合:

```bash
docker compose up auth-postgres -d
bun install && bun run db:migrate
bun run dev:web   # 別ターミナル
bun run dev       # localhost:3100
```

GitHub OAuth / Resend / Vercel Blob は optional。

## 変更フロー

- スキーマ: `db/schema.ts` を編集 → host で `bun run db:generate` → 生成した `drizzle/*.sql` を commit。次回 compose 起動時に `auth-migrate` が適用する
- Proto: `proto/` を編集 → host で `bun run generate` → `src/gen/` と `packages/auth-client/src/gen/` を両方 commit。CI の Buf breaking check に引っかかる変更は SDK の major bump が要る
- codegen は host の bun で実行する ([ADR-0014](./docs/adr/0014-docker-runner-dev-stage-separation.md))

## 運用

- 管理スクリプト: `management/` (`docker compose run --rm auth-service bun run management/<script>.ts`)。MFA ロックアウト救済は `disable-user-mfa.ts <userId>` が唯一の出口 ([ADR-0016](./docs/adr/0016-mfa-self-owned-totp.md))
- `MFA_CHALLENGE_ENABLED=false` で MFA チャレンジを緊急停止できる。明示的な `false` 以外は有効。off の間は Sentry に 6 時間おきに warning が出る
- `AUTH_TRUSTED_PROXY_HOPS`: Bun 起動時の client IP 導出に使う proxy 段数。production では必須 (未設定なら起動拒否)。Workers は `cf-connecting-ip` を見るので不要 (`src/request-context.ts`)
- `MFA_TOTP_ENCRYPTION_KEYS`: `v1:<base64 32byte>[,v2:...]` の鍵 ring、最大 version が現行。ローテーションは新 version を追記して deploy、旧 version は該当行が 0 になるまで残す ([ADR-0016](./docs/adr/0016-mfa-self-owned-totp.md))
- `AUTH_SERVICE_KEY` の rotation: [runbook](./docs/runbook/service-key-rotation.md)
- 手動回帰 QA: [docs/qa/manual-regression.md](./docs/qa/manual-regression.md)
