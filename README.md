# taimei-auth

taimei の認証サービス。

## ローカル起動

```bash
cp .env.example .env
docker compose up --build --watch
```

http://auth.taimei-code.localhost:3100/ を開く。Magic Link と招待メールは送信されず、URL がサーバの log に出る。フィーチャーフラグは初めて起動した時はどれも off で、Local Explorer (http://localhost:3100/cdn-cgi/local/explorer/flagship/FLAGS) で作って切り替える。Local Explorer は開発者ホーム (http://auth.taimei-code.localhost:3100/dev-home) の「フィーチャーフラグ」の link からも開ける。この扱いと、切り替えが残る範囲と消し方は [ADR-0030](./docs/adr/0030-feature-flags-by-flagship.md) の Decision 6 にある。compose を使わない起動は `e2e/start-server.sh` に倣う。

## スキーマと Proto の変更

codegen は host の bun で実行し、生成物を commit する ([ADR-0014](./docs/adr/0014-docker-runner-dev-stage-separation.md))。

- スキーマ: `db/schema.ts` を編集して `bun run db:generate`
- Proto: `proto/` を編集して `bun run generate`

## 運用

- 管理スクリプト: `docker compose run --rm auth-service bun run management/<script>.ts`。MFA ロックアウトの救済は `disable-user-mfa.ts <userId>` だけ。本物のメールを送るので、本物の `AUTH_RESEND_KEY` を手元で渡さない
- `MFA_CHALLENGE_ENABLED=false` で MFA チャレンジを緊急停止する
- `AUTH_TRUSTED_PROXY_HOPS`: 本番以外の Bun の server が client IP を導出する proxy の段数
- `MFA_TOTP_ENCRYPTION_KEYS` のローテーション: 新しい version を追記して deploy し、旧 version はその version で暗号化した行が 0 になるまで残す ([ADR-0016](./docs/adr/0016-mfa-self-owned-totp.md))
- `AUTH_SERVICE_KEY` のローテーション: [runbook](./docs/runbook/service-key-rotation.md)
