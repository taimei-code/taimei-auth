# Service Key 緊急 rotation 手順

`AUTH_SERVICE_KEY` (**Service Key**、定義は [`CONTEXT.md`](../../CONTEXT.md)) が漏洩した場合の緊急 rotation 手順である。所要時間は推定 30 分。

**定期 rotation の運用 (rotation 周期、grace period の値、reminder の設計) はこの文書の対象外**とする。A-2 (AWS Secrets Manager 統合) に着手する時に再検討する。

## 前提

- `CONTEXT.md` の **Service Key** のとおり、`AUTH_SERVICE_KEY` (active) と `AUTH_SERVICE_KEY_PREVIOUS` (optional) の 2 本を同時に受理する。判定は `verifyServiceKey` (`src/service-key.ts`)、鍵の集合は `getValidServiceKeys()` が返す
- 正しい手順で実施すれば **end user への影響は 0** である
- 手順を誤ると (例: consumer を更新する前に PREVIOUS を削除する)、taimei から taimei-auth への RPC が全て 401 になり、end user 全員の session 検証が失敗する

## 手順

### 1. 新 key 生成

```bash
openssl rand -hex 32
```

出力 (例: `a1b2c3d4...`) を **新 key** として控える。

### 2. taimei-auth の env を更新 + redeploy

- `AUTH_SERVICE_KEY_PREVIOUS` に現在の `AUTH_SERVICE_KEY` の値を設定する
- `AUTH_SERVICE_KEY` に 1 で生成した新 key を設定する

deploy が完了すると、taimei-auth は新 key と旧 key の両方を受理する。

### 3. consumer (taimei) の env を更新 + redeploy

- consumer 側の `AUTH_SERVICE_KEY` に 1 で生成した新 key を設定する

deploy が完了すると、consumer は新 key を送信する。

### 4. 監視で旧 key 使用が 0 件であることを確認

旧 key を送信する consumer instance が残っていないことを Sentry またはログで確認する (通常は数分から数時間かかる)。

### 5. taimei-auth から PREVIOUS を削除 + redeploy

- `AUTH_SERVICE_KEY_PREVIOUS` を env から削除する

deploy が完了すると、旧 key は完全に無効になる。

## トラブルシューティング

- **3 の完了前に 5 を実行してしまった**: consumer にはまだ旧 key を送る instance があるため 401 が連続し、end user 全員の session 検証が失敗する。即座に `AUTH_SERVICE_KEY_PREVIOUS` に旧 key を戻して redeploy し、3 をやり直す
- **新 key の deploy 完了確認**: taimei-auth 側で `getValidServiceKeys()` の戻り値の件数 (2) をログに出し、両方が含まれていることを確認する

## env 設定例

`.env.example` には secret を含めないため、この runbook に env の形式を残す:

```bash
# active key (必須)
AUTH_SERVICE_KEY=<32-byte hex>

# 緊急 rotation 時にのみ set する optional な旧 key。通常運用では unset。
AUTH_SERVICE_KEY_PREVIOUS=
```

## 関連

- 導入経緯: PR #49 (dual-key rotation + session revoke + magic-link rate limit)
