# Migration Strategy

Dual Read/Write の手順を、必要になった時のための playbook として残す。SDK v1.0 の contract を凍結した後、proto に breaking change を入れる際の段階移行手順である。

## いつ書くか / 発動条件

以下のいずれかに該当した時に、この文書に従って実装を始める。それまでこの文書は休眠状態でよい。

| トリガー | 想定シナリオ |
|---|---|
| 別 IdP への移行 | better-auth から Keycloak / Auth0 / 自前実装等へ切り替える時 |
| proto v2 への切替 | v1 contract に互換性のない変更を入れる必要が出た時 (新しい session 表現 / Become support / Multi-tenant 等) |
| 2 番目の consumer が SDK 接続 | taimei 以外のプロダクトが `@taimei-code/auth-client` を採用する時。新しい consumer が v2 を必要とし taimei が v1 のままなら並行運用が必要になる |

## 戦略 (高レベル)

freee の authenticator gem `PekozRunner` パターンの縮小版を採用する。実装規模は freee の 1/10 程度である。

### 段階 1: Dual Read

新旧両方の endpoint / payload を read できるようにする。

- SDK 内の feature flag (`USE_LEGACY_PROTO` 等) を環境変数または build flag で切り替える
- consumer は `if (FLAG) verifySessionV1() else verifySessionV2()` で分岐する
- proto v1 / v2 を**同時に generate** して両方を import する (`src/gen/v1/*` + `src/gen/v2/*`)

### 段階 2: Dual Write

新旧両方を書き込む期間を設ける (session 発行 / revision update 等の write path)。

- write 側 (taimei-auth) で v1 / v2 両方の store を更新する
- v1 reader が読めること、v2 reader も読めることを invariant として check する
- production traffic で 1〜2 週間並行 write し、エラー率を監視する

### 段階 3: 切替

- consumer (taimei) を v2 のみ読むように deploy する
- v1 reader を deprecated 警告にする
- 1〜2 週間問題なければ v1 write を停止する

### 段階 4: 削除

- v1 endpoint / proto / dual write code を削除する
- SDK の major 版を 1 つ進める

## proto 互換性ルール (v1.0 凍結後の運用)

CI の `buf breaking --against '.git#branch=main'` が機械的に検証する項目:

- field 番号の再利用禁止 (`reserved` で保護)
- enum 値の削除禁止 (`reserved` で保護)
- message 名 / service 名 / rpc 名の変更禁止
- field の型変更禁止 (int32 → string 等)
- oneof からの field の抜き出し禁止

許容される変更:

- 新規 field の追加 (未使用の field number を消費する)
- 新規 message / service / rpc の追加
- `optional` キーワードの追加 (proto3 optional)
- comment / deprecation marker の追加

## SDK major bump の判定基準

| 変更 | bump 判定 |
|---|---|
| proto に新 field 追加 | minor (v1.1.0) |
| `Result` enum に新値追加 | minor |
| 新 RPC method 追加 | minor |
| 既存 RPC の wire format 変更 | major (v2.0.0)。この文書に従って Dual Read/Write を行う |
| TypeScript 型 signature の breaking 変更 (再 narrow / 型名変更等) | major |
| 内部実装の refactor で外部 API 不変 | patch (v1.0.1) |

## 関連

- この文書の発動条件は SDK 設計ノート (internal) の「Dual Read/Write は実装不要、proto 設計で将来性を排除しないことだけ守る」という原則を起点とする
- 別 IdP への移行時 (better-auth から自前 IdP 等) はここに記載した段階移行を発動する
- freee `authenticator` gem `PekozRunner` (出典、freee 内部リポ)
