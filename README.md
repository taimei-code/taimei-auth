# taimei-auth

taimei の認証サービス。better-auth + Hono (Bun) + drizzle (Postgres) + Redis。Web UI / IdP / User・Account・Session DB を 1 サービスに同居させている。

アーキテクチャ詳細とコーディング境界は [`CLAUDE.md`](./CLAUDE.md) を参照。設計決定の履歴は [`~/.claude/plans/taimei/`](file:///home/yasuaki-omokawa/.claude/plans/taimei/) (ローカル) を参照。

---

## ローカル起動 (docker compose)

`docker compose up --build` 一発で「アカウント登録 → Magic Link ログイン → プロフィール確認」まで通せる。

### 1. .env 用意

```bash
cp .env.example .env
```

GitHub OAuth / Resend / Vercel Blob (`BLOB_READ_WRITE_TOKEN`) は optional。未設定でも Magic Link がサーバ log に出るのでログインまでは動作確認可能。avatar アップロードを試す場合のみ `BLOB_READ_WRITE_TOKEN` が要る。

### 2. compose 起動

```bash
docker compose up --build
```

3 サービス + 1 one-shot job が立ち上がる:

| サービス | ポート | 用途 |
|----------|-------|------|
| `auth-postgres` | 5435 (host) → 5432 | User / Session / Account / Verification |
| `auth-redis` | 6380 (host) → 6379 | Better Auth secondaryStorage |
| `auth-migrate` | - | drizzle-kit migrate を起動毎に実行 (idempotent) |
| `auth-service` | 3100 | Hono + Vite SPA (`/auth/*`, `/account/*`) |

### 3. 動作確認

```bash
curl http://localhost:3100/health
# => {"status":"ok","checks":{"db":"ok","redis":"ok"}}
```

ブラウザで <http://localhost:3100/> にアクセス。session-aware な root ハンドラが状態に応じて振り分ける:

- 未認証 → 共通ログイン画面 (`/auth/?service_name=accounts&redirect_url=http://localhost:3100/account`) に 302。新規登録したい場合は画面下部の「新規登録」リンクから共通サインアップ画面へ
- ログイン済 → `/account` に 302

メールアドレス (+ 新規なら名前) を入力 → `Magic Link を送信` → サーバ log に Magic Link URL が出る:

```
[TEST] Magic Link for me@example.com: http://localhost:3100/api/auth/magic-link/verify?token=...&callbackURL=http://localhost:3100/account
```

URL を別タブで開くと `/account` に遷移し、GitHub Settings 風の sidebar (プロフィール / セキュリティ / セッション / 連携アカウント) と中央の編集パネルが表示される。プロフィール編集 / アバター変更 / 退会 / ログアウトはここから操作する。

### 4. DB 確認

```bash
docker compose exec auth-postgres psql -U postgres auth -c 'SELECT email, name FROM "user";'
```

---

## ホスト側で bun を直接動かす

postgres / redis のみ docker で立てて、auth-service は host で `bun run dev`:

```bash
docker compose up auth-postgres auth-redis -d
bun install
bun run db:migrate
bun run dev:web   # 別ターミナル: Vite dev server (5173)
bun run dev       # Hono server (3100)
```

`.env` の `DATABASE_URL` / `REDIS_URL` がホスト用の `localhost:5435` / `localhost:6380` を指していることを確認。

---

## compose での環境操作

### 起動 / 停止

```bash
docker compose up --build       # 初回 / Dockerfile・package.json 変更後
docker compose up -d            # 2 回目以降 (background)
docker compose down             # 停止 (DB データは保持)
docker compose down -v          # 停止 + Postgres volume も削除 (clean start)
```

### ソース変更を反映する

```bash
docker compose up --watch       # src/ db/ の変更が auto sync (HMR ではないが reload は速い)
```

`package.json` を変更した場合は watch では拾わないので `docker compose up --build` で rebuild。

### ログ確認

```bash
docker compose logs -f auth-service    # follow
docker compose logs auth-service | grep "Magic Link"   # Magic Link URL の取り出し
```

### 個別サービスの rebuild

`src/auth.ts` 等 server コードだけ変えたとき:

```bash
docker compose up -d --build auth-service
```

### DB / Redis に入る

```bash
docker compose exec auth-postgres psql -U postgres auth
docker compose exec auth-redis redis-cli
```

### スキーマ変更フロー

1. `db/schema.ts` を編集
2. `docker compose run --rm auth-service bun run db:generate` で `drizzle/NNNN_*.sql` を生成 (commit する)
3. 次回 `docker compose up` 時に `auth-migrate` service が自動適用 (手動実行は `docker compose run --rm auth-migrate`)

> **DB trigger は `drizzle/manual/` に分離**: PL/pgSQL trigger は drizzle-kit が管理しないため `drizzle/manual/*.sql` に置く。`auth-migrate` service が `bun run db:migrate` 後に `bun run db:migrate-manual` (db/migrate-manual.ts) を実行して順次 apply する。`bun run db:generate` の再生成で trigger SQL が消える事故を防ぐための分離。

### Proto 変更フロー

1. `proto/` 配下の `.proto` を編集
2. `docker compose run --rm auth-service bun run generate` で `src/gen/` を再生成し、同 script が `packages/auth-client/src/gen/` へ自動コピー (両方 commit する)
3. CI の `Buf breaking check` step が `main` を baseline に wire 互換性違反を検出する。意図的な breaking が必要な場合は SDK の major 版を bump し、CHANGELOG に migration 例を追記すること
4. 別 IdP 移行や proto v2 切替で並行運用が必要になった時は `docs/migration-strategy.md` の Dual Read/Write 段階移行 playbook を発動する

---

## スコープ外 (現状未対応)

- GitHub OAuth — env 設定 + GitHub App 側で `http://localhost:3100/api/auth/callback/github` を Authorization callback URL に登録が必要
- Resend 経由のメール送信 — local では console.log で代替
- `app.taimei-code.local` 経由の cross-subdomain 動作 — `/etc/hosts` 編集 + reverse proxy が要るため別タスク
- Passkey / パスワード変更 / MFA — `/account/security` に枠だけあり、本番デプロイ後の拡張機能フェーズで実装予定
- セッション個別 revoke / 連携アカウント追加・解除 — `/account/sessions` `/account/connections` に閲覧 UI のみ、変更操作は本番デプロイ後の拡張機能フェーズで実装予定

---

## 参考リンク

- [better-auth docs](https://www.better-auth.com/)
- [drizzle-kit](https://orm.drizzle.team/kit-docs/overview)
- [Bun](https://bun.sh/)
