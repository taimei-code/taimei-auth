# 手動回帰 QA (QA-MR-*)

自動化できない (実ブラウザ + 実ドメイン / 外部サービス実連携 / 実 workerd が必要な) 回帰ケースの台帳。

- **ID 体系**: `QA-MR-*` は本ドキュメント専用。`QA-D/E/H/M/R-*` は自動テスト名に埋め込まれた既存体系 (例: `src/handlers/__tests__/account-routes-migrated.test.ts`) で、別物。重なる領域は相互参照する
- **実行契機**: 各ケースの「契機」列のイベントが起きる PR のマージ前。加えて本番デプロイ後スモークとして QA-MR-01 / QA-MR-03 を実施する
- **担当**: 該当 PR の作者 (デプロイ後スモークはデプロイ実施者)
- **記帳**: 実施したら PR コメントに `QA-MR-xx: PASS/FAIL (日付)` を残す

自動化済みの認証動線 (magic link sign-in / sign-up → 事業所作成 / 招待受諾 / MEMBER 権限 UI / 唯一 OWNER の退会中断 / 使用済み link 拒否) は `e2e/*.e2e.ts` (`bun run test:e2e`) がカバーするため本台帳の対象外。

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

- **契機**: better-auth `socialProviders` / OAuth callback / account linking を触る PR
- **前提**: `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` を設定した環境 (local 可。未設定だと GitHub ボタン自体が機能しない)
- **手順**:
  1. `/auth/?service_name=accounts&redirect_url=<有効 URL>` を開き「GitHub でログイン」を押す
  2. GitHub の認可画面で許可する
  3. callback 後の遷移先と、`/account` → 外部連携画面に GitHub 連携が表示されることを確認する
- **期待結果**: callback が 500 にならず、新規 user は事業所登録へ、既存 user は redirect_url へ遷移する。audit log に `sign_in` (method=github) が記録される

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
