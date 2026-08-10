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
- **アカウント** … プロフィール / セキュリティ / セッション / 連携アカウント。プロフィール編集 / アバター変更 / 多要素認証 (MFA) の有効化・無効化 / 退会 / ログアウトをここから操作する

`/account/security` から認証アプリ (TOTP) を登録すると、以後のログインは Magic Link / GitHub OAuth のどちらでも、一次認証のあとに 6 桁コードの入力画面 (`/auth/mfa`) を挟む。認証アプリを失った場合は、有効化時に一度だけ表示されるリカバリーコードで通過する。設計判断は [ADR-0013](./docs/adr/0013-mfa-totp-challenge.md) を参照。

既存ユーザーを別の事業所へ招待する場合は「メンバー」から招待リンク (Resend メール / 1-click magic link) を発行する。受け取った側は `/auth/signup/accept-invitation` で当該事業所に MEMBER として join する。招待メールもローカルでは実送信されず、Magic Link と同様にサーバ log に URL が出る (magic link 部分は 5 分で失効。失効時は同じメールアドレスへ再招待すると PENDING 招待が再利用され新しい URL が発行される):

```
[TEST] Invitation email for invitee@example.com: http://auth.taimei-code.local:3100/api/auth/magic-link/verify?token=...&callbackURL=...accept-invitation...
```

## compose での環境操作

codegen (`db:generate` / `generate`) は生成物を working tree へ書き出して commit する作業のため、**host の bun で実行する**。DB には接続しないので postgres / redis は不要 — `bun install` さえ済んでいれば動く。auth-service は本番相当の runner stage (devDependencies 抜き) で動くため、drizzle-kit / buf / biome / tsc などの dev ツールはコンテナ内に無い (実行すると exit 127)。host に bun を入れずに dev ツールを使いたい場合は full toolchain の auth-migrate (dev stage) を使う (`docker compose run --rm auth-migrate bun run lint` 等。生成物を伴わないコマンドに限る)。設計判断は [ADR-0014](./docs/adr/0014-docker-runner-dev-stage-separation.md) を参照。

### スキーマ変更フロー

1. `db/schema.ts` を編集
2. host で `bun run db:generate` を実行し `drizzle/NNNN_*.sql` を生成 (commit する)
3. 次回 `docker compose up` 時に `auth-migrate` service が自動適用 (手動実行は `docker compose run --rm auth-migrate`)

### Proto 変更フロー

1. `proto/` 配下の `.proto` を編集
2. host で `bun run generate` を実行し `src/gen/` を再生成、同 script が `packages/auth-client/src/gen/` へ自動コピー (両方 commit する)
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

## 運用

### 管理スクリプト (`management/`)

DB に直接つなぐ one-shot / 定期スクリプト。compose 環境では `docker compose run --rm auth-service bun run management/<script>.ts` で実行する。

| スクリプト | 用途 |
|---|---|
| `sweep-abandoned-signups.ts` | 登録途中放棄アカウントの定期 sweep (dry-run → `--execute` の 2 段階)。詳細: [ADR-0010](./docs/adr/0010-company-account-deletion-lifecycle.md) |
| `backfill-orphan-cleanup.ts` | ghost membership と orphan アカウントの one-shot 掃除 (同 2 段階)。詳細: [ADR-0010](./docs/adr/0010-company-account-deletion-lifecycle.md) |
| `disable-user-mfa.ts` | 多要素認証 (MFA) のロックアウト救済。userId 指定で当該ユーザーの MFA を強制的に無効化する |

```bash
bun run management/disable-user-mfa.ts <userId>
```

認証アプリとリカバリーコードを両方失ったユーザーには**自力で復帰する手段がない** (ログインはチャレンジ通過が必須、再登録は MFA 有効中は拒否、無効化は有効なコードの入力が必要)。このスクリプトがロックアウトからの唯一の出口で、実行すると当該ユーザーの `two_factor` 行の削除 + `twoFactorEnabled=false` + `mfa_disabled` audit event の記録 + 本人への通知メール送信が行われる。

### MFA チャレンジの緊急停止 (`MFA_CHALLENGE_ENABLED`)

better-auth の更新でチャレンジが機能しなくなった場合など、deploy の rollback なしにチャレンジ強制だけを止めるための env。

- `MFA_CHALLENGE_ENABLED=false` … チャレンジを発火させず一次認証だけでログインさせる (= MFA を実質的に無効化する)
- 未設定 / 空文字 / それ以外の値 … すべて有効。明示的な `false` 以外は保護が外れない側に倒す

off で動作している間は Sentry に warning が 6 時間おきに出続ける (止めたまま気づかない状態を作らないため)。復旧したら必ず戻す。

### client IP の導出 (`AUTH_TRUSTED_PROXY_HOPS`)

audit ログの `ip` と IP 軸 rate limit の key は「client が詐称できない出所」からしか取らない (`src/request-context.ts`)。信用できる出所は runtime で違う。

- **Cloudflare Workers (本番)** … Cloudflare が edge で上書きする `cf-connecting-ip` のみを見る。`X-Forwarded-For` / `X-Real-IP` は読まない。**設定不要**
- **Bun (compose / e2e / self-managed)** … `X-Forwarded-For` を**末尾から** `AUTH_TRUSTED_PROXY_HOPS` 番目 (= 自前 proxy が付け足した位置) で読む。client は先頭にしか値を積めないため、この位置は詐称できない

| 値 | 想定構成 |
|---|---|
| `1` | proxy 1 段 (nginx / ALB 等) が XFF に追記する構成。`X-Real-IP` も突き合わせ、食い違えば `unknown` に倒す |
| `2` 以上 | 自分たちが運用する proxy の段数。末尾から N 番目を client とみなす |
| `0` | proxy 無しの直公開。ヘッダを一切信用しない (全リクエストが `unknown` になり IP 軸の枠は共有される) |

`APP_ENV=production` で未設定 / 非負整数でない場合は **Bun entry (`src/index.ts`) が起動を拒否する** (`AUTH_SERVICE_KEY` と同じ fail-fast)。既定値で黙って埋めると、audit の `ip` も IP 軸の枠も動いて見えたまま無価値化するため。非 production は未設定なら 1 hop 相当で動く (compose / bun test / e2e は proxy 無しの直公開で、枠自体も 1000/min に緩和されている)。

IP literal (IPv4 / IPv6) として読めない値・hop 数に足りない列・不在ヘッダはすべて `unknown` になる。

### `AUTH_SECRET` のローテーション制約

`AUTH_SECRET` は cookie 署名鍵であると同時に、MFA 登録済みユーザーの TOTP secret とリカバリーコードの暗号鍵を兼ねる。**MFA 登録済みユーザーが 1 人でもいる状態で差し替えると、全員が自力復帰不能なロックアウトに陥る**。差し替えが避けられない場合の手順 (全員を `disable-user-mfa.ts` で無効化してから差し替える) と、この制約を採った理由は [ADR-0013](./docs/adr/0013-mfa-totp-challenge.md) を参照。

`AUTH_SERVICE_KEY` の緊急 rotation 手順は [`docs/runbook/service-key-rotation.md`](./docs/runbook/service-key-rotation.md) にある。

### 手動回帰 QA

自動化できない回帰ケース (実ドメインでの cookie 共有 / GitHub OAuth 実連携 / workerd 実機 / 実メール / 実機の認証アプリ) は [`docs/qa/manual-regression.md`](./docs/qa/manual-regression.md) に台帳化している。該当領域を触る PR のマージ前に実施する。

---

## 現状未対応

- Passkey — `/account/security` に枠だけあり、本番デプロイ後の拡張機能フェーズで実装予定
- セッション個別 revoke / 連携アカウント追加・解除 — `/account/sessions` `/account/connections` に閲覧 UI のみ、変更操作は本番デプロイ後の拡張機能フェーズで実装予定
- 事業所の課金 (Stripe) / 物理削除 (GDPR hard delete) / GUEST・VIEWER role — 本番運用後の trigger 待ち (現状は soft delete + OWNER / MEMBER の 2 role)

---

## 参考リンク

- [better-auth docs](https://www.better-auth.com/)
- [drizzle-kit](https://orm.drizzle.team/kit-docs/overview)
- [Bun](https://bun.sh/)
