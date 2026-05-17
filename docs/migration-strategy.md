# Migration Strategy

ADR-001 R3 + Phase 2 で「実装不要、proto 設計で将来性を排除しないことだけ守る」とした Dual Read/Write の手順を、必要になった時のための playbook として残す。

## いつ書くか / 発動条件

以下のいずれかに該当した時に本 doc に従って実装を始める。それまで本 doc は **dormant** (休眠) で OK。

| トリガー | 想定シナリオ |
|---|---|
| 別 IdP への移行 | better-auth → Keycloak / Auth0 / 自前実装等への切替時 |
| proto v2 への切替 | v1 contract に互換性のない変更を入れる必要が出た時 (新しい session 表現 / Become support / Multi-tenant 等) |
| 2 番目の consumer が SDK 接続 | taimei 以外のプロダクトが `@taimei-code/auth-client` を採用する時、新しい consumer が v2 を必要とし taimei が v1 のままなら並行運用が必要 |

## 戦略 (高レベル)

freee の authenticator gem `PekozRunner` パターンの縮小版を採用する。実装規模は freee の 1/10 程度。

### 段階 1: Dual Read

新旧両方の endpoint / payload を read 可能にする。

- SDK 内で feature flag (`USE_LEGACY_PROTO` 等) を環境変数 / build flag で切替
- consumer は `if (FLAG) verifySessionV1() else verifySessionV2()` で分岐
- proto v1 / v2 を **同時に generate** して両方 import (`src/gen/v1/*` + `src/gen/v2/*`)

### 段階 2: Dual Write

新旧両方を書き込む期間を設ける (session 発行 / revision update 等の write path)。

- write 側 (taimei-auth) で v1 / v2 両 store を更新
- v1 reader が読めること、v2 reader も読めることを invariant として check
- production traffic で 1-2 週間並行 write、エラー率モニタ

### 段階 3: 切替

- consumer (taimei) を v2 のみ読むよう deploy
- v1 reader を deprecated 警告に
- 1-2 週間問題なければ v1 write 停止

### 段階 4: 削除

- v1 endpoint / proto / dual write code を削除
- SDK の major 版を 1 つ進める

## proto 互換性ルール (Phase 2 以降の運用)

CI の `buf breaking --against '.git#branch=main'` で機械的に検証される項目:

- field 番号の再利用禁止 (`reserved` で保護)
- enum 値の削除禁止 (`reserved` で保護)
- message 名 / service 名 / rpc 名の変更禁止
- field の型変更禁止 (int32 → string 等)
- oneof からの field 抜き出し禁止

許容される変更:

- 新規 field 追加 (未使用の field number を消費)
- 新規 message / service / rpc 追加
- `optional` キーワード追加 (proto3 optional)
- comment / deprecation marker 追加

## SDK major bump の判定基準

| 変更 | bump 判定 |
|---|---|
| proto に新 field 追加 | minor (v1.1.0) |
| `Result` enum に新値追加 | minor |
| 新 RPC method 追加 | minor |
| 既存 RPC の wire format 変更 | major (v2.0.0) + 本 doc に従って Dual Read/Write |
| TypeScript 型 signature の breaking 変更 (再 narrow / 型名変更等) | major |
| 内部実装の refactor で外部 API 不変 | patch (v1.0.1) |

## 関連

- ADR-001 R3 (本 doc の発動条件)
- ADR-002 Phase 4 (別 IdP 移行時の参照)
- freee `authenticator` gem `PekozRunner` (出典、freee 内部リポ)
