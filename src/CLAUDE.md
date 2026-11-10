# src/ サーバーサイド実装規則

層境界は [`ADR-0012`](../docs/adr/0012-layered-architecture.md) が、Effect の採用範囲と副作用の置き場は [`ADR-0017`](../docs/adr/0017-effect-v4-full-adoption.md) が定義元である。

## 配置

- 変更理由を所有する業務ドメインを決め、次に層を決め、両方に合う既存の場所へ置く。domain が肥大化したら、技術分類ではなく操作名で下位ディレクトリを作る。

## Effect様式

- 各 domain は `ports.ts` に Repository の Effect 面を、`wiring.ts` に production の結線を置く。
- Repository 以外の port は、Layer で差し替えた時に何かを隠せる場合だけ置く。既存の service (`TtlStore` / `EmailSender` など) を使う関数は use-case から直接呼び、テストはその service の Layer を差し替えて、起きた結果 (計数、送信) を観測する。
- tx 後の副作用は tx の外に置くか、tx の中から `afterCommit` で commit 後に登録する。
- program は副作用を closure で受け取らず、「何をすべきか」を直和型の値で返す (例: `ChallengeDecision`)。

## test

- domain のテストは `<domain>/__tests__/` に、Transport のテストは `handlers/__tests__/` / `rpc/__tests__/` に、複数 domain にまたがる invariant は `src/__tests__/` に置く。
- DB に接触するテストは、失敗を `Effect.flip` / `Effect.exit` で failure class として観測する。
- workerd 固有の挙動は local のテストで完了扱いにせず、manual regression か `wrangler dev --remote` で確認する。

## 静的な検査

1 file の source の形で決まる禁止は `lint/oxlint-plugin.mts` の表 (`ROWS`) に書く。行の形は ADR-0026 が定義元である。

## gotcha

- segment 数が同じ Hono route では、static route を parameter route より先に登録する。
- workerd では request をまたいで I/O resource を再利用しない (ADR-0011)。
