# 手動回帰 QA (QA-MR-*)

自動化できない (実ブラウザ + 実ドメイン / 外部サービス実連携 / 実 workerd / 別 repo の build context が必要な) 回帰ケースの台帳。

- **ID 体系**: `QA-MR-*` は本ドキュメント専用。`QA-D/E/H/I/M/R-*` は自動テスト名に埋め込まれた既存体系 (例: `src/handlers/__tests__/account-routes-migrated.test.ts`) で、別物。重なる領域は相互参照する
- **実行契機**: 各ケースの「契機」列のイベントが起きる PR のマージ前。加えて本番デプロイ後スモークとして QA-MR-01 / QA-MR-03 を実施する
- **担当**: 該当 PR の作者 (デプロイ後スモークはデプロイ実施者)
- **記帳**: 実施したら PR コメントに `QA-MR-xx: PASS/FAIL (日付)` を残す

自動化済みの認証動線 (magic link sign-in / sign-up → 事業所作成 / 招待受諾 / MEMBER 権限 UI / 唯一 OWNER の退会中断 / 使用済み link 拒否 / 多要素認証 (MFA) の有効化 → チャレンジ通過 → リカバリーコード) は `e2e/*.e2e.ts` (`bun run test:e2e`) がカバーするため本台帳の対象外。

---

## QA-MR-01: cross-subdomain Cookie の実ドメイン共有 (#30 / #89 家系)

- **契機**: `AUTH_COOKIE_DOMAIN` / `AUTH_TRUSTED_ORIGINS` / better-auth `advanced.crossSubDomainCookies` 周辺を触る PR、および本番デプロイ後
- **前提**: production (または *.taimei-code.com を持つ staging)。判定ロジック自体は `src/__tests__/cookie-domain.test.ts` が自動検証済み — ここで見るのは実ブラウザの Set-Cookie 属性と実ドメイン間の共有
- **手順**:
  1. ブラウザで `https://auth.taimei-code.com` にログインする
  2. DevTools → Application → Cookies で session cookie の `Domain` が `.taimei-code.com`、`Secure` / `HttpOnly` が付与されていることを確認する
  3. `https://app.taimei-code.com` (consumer app) を開き、再ログインなしで認証状態が引き継がれることを確認する
- **期待結果**: cookie domain が `.taimei-code.com` で、subdomain 間で session が共有される。ログイン後に consumer 側で 401 / redirect loop にならない

## QA-MR-02: GitHub OAuth 実連携 (第 2 の認証経路)

- **契機**: better-auth `socialProviders` / OAuth callback / account linking / **MFA チャレンジ** の matcher (`/callback/:id`) を触る PR
- **前提**: `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` を設定した環境 (local 可。未設定だと GitHub ボタン自体が機能しない)
- **手順**:
  1. `/auth/?service_name=accounts&redirect_url=<有効 URL>` を開き「GitHub でログイン」を押す
  2. GitHub の認可画面で許可する
  3. callback 後の遷移先と、`/account` → 外部連携画面に GitHub 連携が表示されることを確認する
  4. 多要素認証 (MFA) を有効にした user で 1〜3 を繰り返す
  5. 多要素認証 (MFA) を有効にした user がログイン済みの状態で GitHub アカウント連携を実行する
- **期待結果**: callback が 500 にならず、新規 user は事業所登録へ、既存 user は redirect_url へ遷移する。audit log に `sign_in` (method=github) が記録される。**MFA 有効ユーザーは callback 後にチャレンジ画面 (`/auth/mfa`) へ遷移し、TOTP 通過後に本来の遷移先へ着地する** (その時点で `sign_in` が 1 件記録される)。既ログイン状態からのアカウント連携はチャレンジに飛ばされず、既存 session が維持される

## QA-MR-03: workerd 固有挙動 — Worker hung 非再発 (#91)

- **契機**: `db/client.ts` (RoutingPool) / `src/worker.ts` / 常駐リソースのライフサイクル / wrangler.jsonc を触る PR、および本番デプロイ後
- **前提**: `wrangler dev --remote` (実 workerd + 実バインディング。local の miniflare では再現しない — ルート CLAUDE.md の gotcha 参照)
- **手順**:
  1. `wrangler dev --remote` で起動する
  2. DB を踏む endpoint (`/health`) を 20 回程度連打する (warm isolate に前 request のアイドル接続を掴ませる)
  3. `wrangler tail` で `outcome: exception` が出ていないことを確認する
- **期待結果**: すべて 200 (または正しい degraded 応答) で、"Worker hung" による 500 が発生しない

## QA-MR-04: Resend 実メールのレンダリング

- **契機**: `src/email/` (テンプレート / sanitize / 差出人) を触る PR
- **前提**: `RESEND_API_KEY` を設定した環境 (local は console 出力のみで実メールが飛ばない)。受信可能なテストアドレス
- **手順**:
  1. magic link ログインを実行し、受信メールの件名・本文・リンクを実メールクライアントで確認する
  2. 招待メール (事業所名・招待者名入り) を送信し、表示名に日本語・記号を含むケースで崩れないことを確認する
- **期待結果**: リンクが正しい環境の URL を指す。表示名は `sanitizeDisplayText` 適用後の内容で、ヘッダ崩れ・方向制御文字による偽装表示がない

## QA-MR-05: magic link の期限切れ (5 分)

- **契機**: better-auth `magicLink.expiresIn` / verification 保存方式を触る PR
- **前提**: local で可 (使用済み link の拒否は `e2e/auth-flow.e2e.ts` が自動化済み。実時間の経過が必要な期限切れのみ手動)
- **手順**:
  1. magic link を発行し、クリックせず 5 分以上待つ
  2. 期限切れの link を開く
- **期待結果**: session は作られず、エラー (EXPIRED_TOKEN 系) 付きで sign-in 画面へ戻される

## QA-MR-06: 実機の認証アプリでの TOTP 登録・検証 (QR スキャン)

- **契機**: `src/mfa/` / `src/auth-plugins/mfa-challenge.ts` / `MfaEnrollDialog` / `otpauth://` URI の生成を触る PR
- **前提**: 実機のスマートフォンと認証アプリ (できれば 2 種類以上)。TOTP の計算そのものは `e2e/mfa-flow.e2e.ts` が自動化済み — ここで見るのは実アプリが QR コードと URI を解釈できるか
- **手順**:
  1. `/account/security` の「多要素認証 (MFA)」を有効化し、表示された QR コードを認証アプリのカメラで読み取る
  2. アプリ側に表示されるアカウント名と発行者を確認する
  3. アプリが表示する 6 桁コードを入力して有効化を完了する
  4. ログアウトして再ログインし、チャレンジ画面で同じアプリのコードを入力する
  5. QR を使わず、画面の secret 文字列を手入力して登録した場合も 3〜4 が成立することを確認する
- **期待結果**: QR がどの認証アプリでも読み取れ、アプリ側の表示がサービス表示名 + 本人のメールアドレスで他アカウントと区別できる。生成されたコードで有効化とチャレンジの両方を通過できる。手入力の secret でも同じ結果になる

## QA-MR-07: MFA 有効化 / 無効化の実 Resend メール

- **契機**: 多要素認証 (MFA) の有効化 / 無効化の通知メールテンプレート (`src/email/`) を触る PR (QA-MR-04 の MFA 版。同じ前提・同じ観点で見る)
- **前提**: `RESEND_API_KEY` を設定した環境 (local は console 出力のみで実メールが飛ばない)。受信可能なテストアドレス
- **手順**:
  1. 多要素認証 (MFA) を有効化し、受信メールを実メールクライアントで確認する
  2. 続けて無効化し、同様に確認する
- **期待結果**: 有効化通知・無効化通知が本人宛に 1 通ずつ届く。文言は canonical 用語 (「多要素認証 (MFA)」「リカバリーコード」「認証アプリ」) で、TOTP secret やリカバリーコードの実体を本文に含まない。本文中のリンクが正しい環境の URL を指す

## QA-MR-08: 実機スマートフォンでのコード入力 (数字キーボード / OTP 自動入力)

- **契機**: `use-mfa-code-entry` / `MfaChallenge` / 有効化・無効化ダイアログのコード入力欄を触る PR
- **前提**: 実機スマートフォン (iOS Safari / Android Chrome)。入力支援属性の付与自体は自動テストで確認済み — ここで見るのは実 OS がその属性にどう反応するか
- **手順**:
  1. 実機で `/auth/mfa` を開き、コード入力欄をタップする
  2. 認証アプリからコードをコピーし、入力欄に貼り付けて送信する
  3. リカバリーコード入力に切り替え、同様に貼り付けて送信する
- **期待結果**: 6 桁入力欄で数字キーボードが開く。OS が OTP 自動入力の候補を出した場合はタップだけで 6 桁が入る。貼り付け時に全角数字や空白が混ざっても半角詰めに正規化されて通り、`invalid_code` にならない。リカバリーコード入力に切り替えると 6 桁前提の入力制限が外れ、コードをそのまま入力・貼り付けできる

## QA-MR-09: consumer repo (taimei) からの cross-repo build と起動

- **契機**: Dockerfile の stage 構成 / `packages` COPY 方式を変える PR
- **前提**: consumer repo `~/mydev/taimei` を clone 済み。port 3100 が競合するため本 repo の compose を先に落とす (`docker compose down`)。taimei は本 repo の **unpinned な main** を clone するため、マージした時点で全 taimei branch に即波及する (= 実施はマージ前)。本 repo 側の CI docker job と `scripts/docker-smoke.sh` は build と単発 probe までで、dev image を server として長時間 boot する経路はこのケースだけがカバーする
- **手順**:
  1. `cd ~/mydev/taimei && docker compose -f docker-compose.e2e.yml build e2e-auth-service`
  2. 依存 service ごと up し、`e2e-auth-service` の起動ログ (migration 実行を含む) を確認する
  3. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/health`
- **期待結果**: build が `Workspace dependency not found` 等で落ちず、`bunx drizzle-kit migrate` が完走して `/health` が 200 を返す
