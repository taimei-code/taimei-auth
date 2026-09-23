# ADR-0016: MFA (TOTP) を otpauth + 自前 schema で完全自前化し、twoFactor プラグインを撤去する

## Status

Accepted (2026-08-30)。`mfa-totp-self-owned` ブランチで実装した。ADR-0013 を supersede する。

デプロイ ② (旧オブジェクトの DROP) は 2026-08-31 に適用済みである。以降、デプロイ ① より前へはロールバックできない。

## Context

ADR-0013 は better-auth の twoFactor プラグインを土台に、チャレンジ強制、封じ込め、登録遷移 guard を
自前で積み上げる構成を採った。運用してみると、コストの源泉はプラグインが所有する書き込み
(トランザクションでない 2 回の書き込みと、flag と行の複製) にあり、そこから 5 状態の状態機械、遷移 guard、
内部形式をハードコピーした封じ込めの静的テスト群、`temporarily_unavailable` の運用 (Retry-After、解除
runbook、停止確認) が派生していた。

PoC (crypto core と session 発行) とプロトタイプの 2 段で、TOTP 検証、暗号保管、チャレンジ、session
発行の全書き込みを自前の単文または 1 tx に置けることを確認した (検証済みの挙動は本実装のテスト群 (`src/mfa/totp/__tests__/` / `db/__tests__/mfa-totp.race.test.ts`) として規範化した)。既存の MFA 登録データは
移行せず破棄し、再セットアップを案内する判断が承認されたため、移行期間なしのゼロベース切替が
可能になった。

## Decision

- MFA (TOTP、リカバリーコード、ログインチャレンジ、チャレンジ通過時の session 発行) を自前で所有する。
  TOTP 計算は `otpauth`、暗号は WebCrypto (AES-256-GCM、AAD は user_id、key_version 付きの鍵 ring
  `MFA_TOTP_ENCRYPTION_KEYS`) を使う。better-auth はログイン (Magic Link / GitHub OAuth)、session、user
  管理に残す併用構成とする
- 状態の実体は `mfa_totp` 行のみとする (行なしは未登録、`verified_at` が NULL は登録済み未有効、非 NULL は
  有効の 3 状態。用語の定義は CONTEXT.md「MFA 登録状態」)。flag 列は持たず、「中断した有効化 / 無効化」は構造的に存在しない
- 並行制御は遷移 guard でなく操作文が担う。enroll は PK + ON CONFLICT、activate は識別子照合と
  verified 化と timestep (TOTP の 30 秒刻みの counter) 消費を条件に付けた単文 UPDATE、コード消費は単調比較または `used_at IS NULL` の単文で行う。
  勝者はちょうど 1 つになる
- チャレンジ状態は Redis の 1 key (`mfa:login-challenge:*`、TTL 600 秒) と自前で署名した cookie
  `mfa_login_challenge` (HMAC 鍵は AUTH_SECRET を共有) で持つ。単回消費は getAndDelete で行う。試行枠は
  per-challenge 5 回で fail-closed とする。session 発行は gateway の `issueSessionFor` の 1 窓口で行う
  (`internalAdapter.createSession` と公開 export の `makeSignature` を使い、Max-Age を明示的に付与する)
- チャレンジの要否は、一次認証成功後の after-hook が `mfa_totp.verified_at` の最小射影を読んで決める (+1 SELECT、
  PK で引く 1 行、secret 列には触れない)。flag の複製は再導入しない
- 検証順序: activate は復号とコード検証、revoke、確定 UPDATE の順に行う。誤コードは他の session を失効させない。
  session の rotate は行わない
- リカバリーコードは secret と同じ鍵 ring で可逆暗号にする (登録済み未有効の間に再表示する契約と hash 保管は
  両立しない)。書式は `xxxxx-xxxxx` を 10 個
- sign_in audit はチャレンジ通過の手続が記録する (一次認証の観測は sign-in-observer に残る)
- wire contract の変更は 3 点: `temporarily_unavailable` の削除 (発生源が消滅した)、
  `MfaActivateRequest.enrollment_id` の必須化、`MfaStatusResponse.in_effect` の削除 (2026-09-23 追記)。他の endpoint の
  形は変えない。`in_effect` は ADR-0013 の「中断した無効化」を SPA へ伝える field だった。状態の実体を行だけにする
  上記の決定でその状態は生じなくなり、`in_effect` は常に `enabled` と同じ値を返していた
- 展開は 2 段に分ける。デプロイ ① (切替。旧テーブルを温存しロールバック可) の後、安定稼働を確認してからデプロイ ②
  (旧オブジェクトの DROP と `drizzle/manual/0004` の削除。以降ロールバック不可) を行う

ADR-0013 が導入した次の判断はこの ADR が引き継ぐ: kill-switch (`MFA_CHALLENGE_ENABLED`) と 6h ごとの通報、
redirect-guard (出口検証)、チャレンジ verify の IP rate limit、sign-in 観測の構造。

## Consequences

- 全ログイン (一次認証成功時) に +1 SELECT が加わる。発火点は after-hook のみで、リクエスト毎ではない
- better-auth の非公開形式への結合はゼロになり、残る依存は公開 export (`makeSignature`) と gateway 内の
  `internalAdapter` / `createAuthCookie` のみになる。twoFactor プラグイン、生 path の遮断、遷移 guard、
  guard 解除 CLI、protocol 照合、`temporarily_unavailable` 系の runbook は消滅する
- AUTH_SECRET の固定制約 (差し替えると全登録ユーザーが恒久的にロックアウトされる) が解消する。鍵ローテーションは
  version を追記する手順になる (手順は README「MFA 暗号鍵」節に定義する)
- 既存の MFA 登録は切替時点で全ユーザーが「未登録」になる (データ移行を行わない判断。Context 参照)。保留中チャレンジの失効窓は
  最大 600 秒
- 既存行の一括再暗号化バッチは持たない。旧 key_version の廃止は再登録の案内による (将来バッチを足す選択は妨げない)
- 運用救済は `management/disable-user-mfa.ts` の 1 経路のまま (実行内容は README の運用節に定義する)
