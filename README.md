# taimei-auth

taimei の認証サービス。better-auth + Hono (Bun) + drizzle (Postgres) + Redis。Web UI / IdP / User・Account・Session DB を 1 サービスに同居させている。

---

## ローカル起動 (docker compose)

`docker compose up --build` 一発で「アカウント登録 → Magic Link ログイン → 事業所登録 → アカウント / 事業所管理」まで通せる。

### 1. .env 用意 + /etc/hosts 設定

```bash
cp .env.example .env
```

compose 版は consumer (taimei) との cross-subdomain Cookie を成立させるため auth-service を `auth.taimei-code.local` で動かす (`AUTH_COOKIE_DOMAIN=taimei-code.local` / `AUTH_SERVICE_URL=http://auth.taimei-code.local:3100` を compose 側で固定)。このため **単体起動でもログインフローの動作確認には `/etc/hosts` への追記が必須** (`localhost:3100` だと後述のとおり callbackURL が trusted origin 外で弾かれる):

```
127.0.0.1 app.taimei-code.local auth.taimei-code.local
```

localhost だけで完結させたい場合は compose を使わず host で直接起動する。`.env` を既定値 (`AUTH_COOKIE_DOMAIN=localhost`) のままにすれば `crossSubDomainCookies` が無効化され `localhost:3100` で動く:

```bash
docker compose up auth-postgres auth-redis -d   # DB / Redis のみ compose で起動
bun install && bun run db:migrate
bun run dev:web   # 別ターミナル: Vite dev server
bun run dev       # Hono server (localhost:3100)
```

GitHub OAuth / Resend / Vercel Blob (`BLOB_READ_WRITE_TOKEN`) は optional。未設定でも Magic Link がサーバ log に出るのでログインまでは動作確認可能。avatar アップロードを試す場合のみ `BLOB_READ_WRITE_TOKEN` が要る。

### 2. compose 起動

```bash
docker compose up --build --watch
```

### 3. 動作確認

```bash
curl http://localhost:3100/health
# => {"status":"ok","checks":{"db":"ok","redis":"ok"}}
```

ブラウザで以下にアクセスする
http://auth.taimei-code.local:3100/

- 未認証 → 共通ログイン画面 (`/auth/?service_name=accounts&redirect_url=http://auth.taimei-code.local:3100/account`) に 302。新規登録したい場合は画面下部の「新規登録」リンクから共通サインアップ画面へ
- ログイン済 → `/account` に 302

メールアドレス (+ 新規なら名前) を入力 → `Magic Link を送信` → サーバ log に Magic Link URL が出る:

```
[TEST] Magic Link for me@example.com: http://auth.taimei-code.local:3100/api/auth/magic-link/verify?token=...&callbackURL=http://auth.taimei-code.local:3100/account
```

URL を別タブで開くと `/account` に遷移する。**初回登録 (所属事業所がまだ無い) ユーザーは事業所登録ページ (`/auth/signup/company`) に誘導され、事業所名を入力すると OWNER として個人事業所が作られてから `/account` に入る** (server-side `auth-entry-redirect.ts` / `SessionGuard` / page-self の 3 層 guard で「membership 0 件」を判定)。

`/account` は GitHub Settings 風の 2 区分 sidebar:

- **事業所** … 上部の事業所切替 (CompanySwitcher) / 所属事業所 / メンバー / 事業所設定。事業所の作成・編集・削除 (soft delete) ・オーナー委譲・メンバーの role 変更 / 除名をここから操作する
- **アカウント** … プロフィール / セキュリティ / セッション / 連携アカウント。プロフィール編集 / アバター変更 / 退会 / ログアウトをここから操作する

既存ユーザーを別の事業所へ招待する場合は「メンバー」から招待リンク (Resend メール / 1-click magic link) を発行する。受け取った側は `/auth/signup/accept-invitation` で当該事業所に MEMBER として join する。招待メールもローカルでは実送信されず、Magic Link と同様にサーバ log に URL が出る (magic link 部分は 5 分で失効。失効時は同じメールアドレスへ再招待すると PENDING 招待が再利用され新しい URL が発行される):

```
[TEST] Invitation email for invitee@example.com: http://auth.taimei-code.local:3100/api/auth/magic-link/verify?token=...&callbackURL=...accept-invitation...
```

## compose での環境操作

### スキーマ変更フロー

1. `db/schema.ts` を編集
2. `docker compose run --rm auth-service bun run db:generate` で `drizzle/NNNN_*.sql` を生成 (commit する)
3. 次回 `docker compose up` 時に `auth-migrate` service が自動適用 (手動実行は `docker compose run --rm auth-migrate`)

### Proto 変更フロー

1. `proto/` 配下の `.proto` を編集
2. `docker compose run --rm auth-service bun run generate` で `src/gen/` を再生成し、同 script が `packages/auth-client/src/gen/` へ自動コピー (両方 commit する)
3. CI の `Buf breaking check` step が `main` を baseline に wire 互換性違反を検出する。意図的な breaking が必要な場合は SDK の major 版を bump し、CHANGELOG に migration 例を追記すること
4. 別 IdP 移行や proto v2 切替で並行運用が必要になった時は `docs/migration-strategy.md` の Dual Read/Write 段階移行 playbook を発動する

### cross-subdomain Cookie でのローカル動作 (taimei consumer との session 共有)

consumer (taimei) と session Cookie を共有する形で動かす場合でも **reverse proxy は不要**。`/etc/hosts` に次を追加するだけで成立する:

```
127.0.0.1 app.taimei-code.local auth.taimei-code.local
```

compose は cross-subdomain 用に設定済み — auth-service に network alias `auth.taimei-code.local` を付与し、`AUTH_COOKIE_DOMAIN=taimei-code.local` / `AUTH_TRUSTED_ORIGINS` に両 subdomain を登録している。auth-service を `http://auth.taimei-code.local:3100`、consumer の taimei を `http://app.taimei-code.local:3001` で起動すると、Magic Link verify 時に session Cookie が `Domain=taimei-code.local` で発行され、`.taimei-code.local` 配下の subdomain 間で共有される。

Cookie 署名検証 (`AUTH_SECRET`) と RPC 認証 (`AUTH_SERVICE_KEY`) は taimei 側 compose と一致が必須だが、いずれも両 compose に同じ dev 値が hardcoded 済み。

---

## スコープ外 (現状未対応)

- GitHub OAuth — env 設定 + GitHub App 側で `http://localhost:3100/api/auth/callback/github` を Authorization callback URL に登録が必要
- Resend 経由のメール送信 — local では console.log で代替
- Passkey / パスワード変更 / MFA — `/account/security` に枠だけあり、本番デプロイ後の拡張機能フェーズで実装予定
- セッション個別 revoke / 連携アカウント追加・解除 — `/account/sessions` `/account/connections` に閲覧 UI のみ、変更操作は本番デプロイ後の拡張機能フェーズで実装予定
- 事業所の課金 (Stripe) / 物理削除 (GDPR hard delete) / GUEST・VIEWER role — ADR-009 Phase E+ として本番運用後の trigger 待ち (現状は soft delete + OWNER / MEMBER の 2 role)

---

## 参考リンク

- [better-auth docs](https://www.better-auth.com/)
- [drizzle-kit](https://orm.drizzle.team/kit-docs/overview)
- [Bun](https://bun.sh/)
