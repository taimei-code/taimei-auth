# ADR-0016: MFA (TOTP) を otpauth + 自前 schema で完全自前化し、twoFactor プラグインを撤去する

## Status

Accepted (2026-08-30)。`mfa-totp-self-owned` ブランチで実装。ADR-0013 を supersede する。

## Context

ADR-0013 は better-auth の twoFactor プラグインを土台に、チャレンジ強制・封じ込め・登録遷移 guard を
自前で積み上げる構成を採った。運用してみると、コストの源泉はプラグインが所有する書き込み
(非トランザクショナルな 2 書き込み・flag×行の複製) にあり、そこから 5 状態の状態機械、遷移 guard、
内部形式ハードコピーの封じ込め静的テスト群、`temporarily_unavailable` の運用 (Retry-After / 解除
runbook / 停止確認) が派生していた。

PoC (crypto core / session 発行) とプロトタイプ 2 段で、TOTP 検証・暗号保管・チャレンジ・session
発行の全書き込みを自前の単文 / 1 tx に置けることを確認した (検証済み挙動は本実装のテスト群 (`src/mfa/totp/__tests__/` / `db/__tests__/mfa-totp.race.test.ts`) として規範化した)。既存 MFA 登録データは
移行せず破棄し、再セットアップを案内する判断が承認されたことにより、移行期間なしのゼロベース切替が
可能になった。

## Decision

- MFA (TOTP・リカバリーコード・ログインチャレンジ・チャレンジ通過の session 発行) を自前所有する。
  TOTP 計算は `otpauth`、暗号は WebCrypto (AES-256-GCM + AAD=user_id + key_version 付き鍵 ring
  `MFA_TOTP_ENCRYPTION_KEYS`)。better-auth はログイン (Magic Link / GitHub OAuth)・session・user
  管理に残す併用構成
- 状態の実体は `mfa_totp` 行のみ (行なし = 未登録 / `verified_at` NULL = 登録済み未有効 / 非 NULL =
  有効の 3 状態。用語の正本: CONTEXT.md「MFA 登録状態」)。flag 列は持たず、「中断した有効化 / 無効化」は構造的に不在
- 並行制御は遷移 guard でなく操作文が担う: enroll = PK + ON CONFLICT、activate = 識別子照合 +
  verified 化 + timestep (TOTP の 30 秒刻み counter) 消費の条件付き単文 UPDATE、コード消費 = 単調比較 / `used_at IS NULL` の単文。
  勝者はちょうど 1
- チャレンジ状態は Redis 1 key (`mfa:login-challenge:*`、TTL 600 秒) + 自前署名 cookie
  `mfa_login_challenge` (HMAC 鍵は AUTH_SECRET を共有)。単回消費は getAndDelete。試行枠は
  per-challenge 5 回 fail-closed。session 発行は gateway の `issueSessionFor` 1 窓口
  (`internalAdapter.createSession` + 公開 export `makeSignature`。Max-Age 明示付与)
- チャレンジ要否は一次認証成功後の after-hook が `mfa_totp.verified_at` の最小射影を読む (+1 SELECT、
  PK 引き 1 行、secret 列に触れない)。flag 複製の再導入はしない
- 検証順序: activate は復号 + コード検証 → revoke → 確定 UPDATE。誤コードは他 session を失効させない。
  session rotate は行わない
- リカバリーコードは secret と同じ鍵 ring の可逆暗号 (登録済み未有効の間の再表示契約と hash 保管は
  両立しない)。書式 `xxxxx-xxxxx` ×10
- sign_in audit はチャレンジ通過手続が記帳する (一次認証の観測は sign-in-observer に残る)
- wire contract の変更は 2 点のみ: `temporarily_unavailable` の削除 (発生源消滅) と
  `MfaActivateRequest.enrollment_id` の必須化。他 6 endpoint の形は不変
- 展開は 2 段: デプロイ ① (切替。旧テーブル温存でロールバック可) → 安定稼働確認後にデプロイ ②
  (旧オブジェクト DROP + `drizzle/manual/0004` 削除。以降ロールバック不可)

ADR-0013 が導入した次の判断は本 ADR が引き継ぐ: kill-switch (`MFA_CHALLENGE_ENABLED`) と 6h 通報 /
redirect-guard (出口検証) / チャレンジ verify の IP rate limit / sign-in 観測の構造。

## Consequences

- 全ログイン (一次認証成功時) に +1 SELECT。発火点は after-hook のみでリクエスト毎ではない
- better-auth 非公開形式への結合はゼロになり、残る依存は公開 export (`makeSignature`) と gateway 内の
  `internalAdapter` / `createAuthCookie` のみ。twoFactor プラグイン・生 path 遮断・遷移 guard・
  guard 解除 CLI・protocol 照合・`temporarily_unavailable` 系 runbook は消滅
- AUTH_SECRET の固定制約 (差し替え = 全登録ユーザー恒久ロックアウト) が解消。鍵ローテーションは
  version 追記の手順になる (手順の正本: README「MFA 暗号鍵」節)
- 既存 MFA 登録は切替時点で全ユーザー「未登録」になる (データ移行を行わない判断。Context 参照)。保留中チャレンジの失効窓は
  最大 600 秒
- 既存行の一括再暗号化バッチは持たない。旧 key_version の廃止は再登録の案内による (将来バッチを足す選択は妨げない)
- 運用救済は `management/disable-user-mfa.ts` の 1 経路のまま (実行内容の正本: README 運用節)
