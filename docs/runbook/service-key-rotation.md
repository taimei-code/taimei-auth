# Service Key 緊急 rotation 手順

`AUTH_SERVICE_KEY` (taimei → taimei-auth の `/rpc/*` 認証 shared secret) が漏洩した場合の緊急 rotation 手順。所要時間 推定 30 分。

**定期 rotation 運用 (rotation 周期 / grace period 値 / reminder 設計) は本ドキュメント scope 外**。A-2 (AWS Secrets Manager 統合) 着手時に再検討する。

## 前提

- `src/index.ts` の `/rpc/*` middleware は `getValidServiceKeys()` 経由で `AUTH_SERVICE_KEY` (active) + `AUTH_SERVICE_KEY_PREVIOUS` (optional) の両方を受け入れる
- 適切な手順で実施すれば **end user 影響 0**
- 手順ミス (例: PREVIOUS 削除 を consumer 更新前に実行) で taimei → taimei-auth RPC 全 401 → end user 全員 session 検証失敗

## 手順

### 1. 新 key 生成

```bash
openssl rand -hex 32
```

出力 (例: `a1b2c3d4...`) を **新 key** として控える。

### 2. taimei-auth の env を更新 + redeploy

- `AUTH_SERVICE_KEY_PREVIOUS` ← 現 `AUTH_SERVICE_KEY` の値
- `AUTH_SERVICE_KEY` ← 1 で生成した新 key

deploy 完了後、taimei-auth は新 key / 旧 key の両方を accept。

### 3. consumer (taimei) の env を更新 + redeploy

- consumer 側の `AUTH_SERVICE_KEY` ← 1 で生成した新 key

deploy 完了後、consumer は新 key を送信。

### 4. 監視で旧 key 使用が 0 件であることを確認

旧 key を送信する consumer instance が残っていないことを Sentry / log で確認 (typically 数分〜数時間)。

### 5. taimei-auth から PREVIOUS を削除 + redeploy

- `AUTH_SERVICE_KEY_PREVIOUS` を削除 (env から消す)

deploy 完了後、旧 key は完全に無効化。

## トラブルシューティング

- **3 完了前に 5 を実行してしまった**: consumer はまだ旧 key を送る instance がある → 401 連発 → end user 全員に session 検証失敗。即座に `AUTH_SERVICE_KEY_PREVIOUS` に旧 key を戻して redeploy + 3 を再実行
- **新 key の deploy 完了確認**: taimei-auth 側で `getValidServiceKeys()` の戻り値件数 (2) を log に出して両方含まれていることを確認

## env 設定例

`.env.example` には secret を含めないため、本 runbook に env 形式を残す:

```bash
# active key (必須)
AUTH_SERVICE_KEY=<32-byte hex>

# 緊急 rotation 時にのみ set する optional な旧 key。通常運用では unset。
AUTH_SERVICE_KEY_PREVIOUS=
```

## 関連

- 導入経緯: PR #49 (dual-key rotation + session revoke + magic-link rate limit)
