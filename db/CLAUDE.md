# db/ 境界ルール

## DB アクセスは `db/` に閉じる

drizzle の client / schema / query は `db/` に置き、`src/` `web/` `packages/` から `drizzle-orm` や `pg` を直接 import しない。将来 `db/` を別 process に剥がして RPC 越しに呼ぶ。
`src/**` からの import は `biome.json` の `noRestrictedImports` が block する。`web/` と `packages/` は lint が block しないので review で守る。

### 例外 path (正本)

追加は DB 境界の設計変更として review し、`biome.json` も同時に更新する。

- `src/auth.ts`: better-auth が DB adapter と schema を結線する。
- `src/worker.ts`: per-request pool を供給する `@/db/client` import のみ (`biome-ignore` で個別許可)。
- test の seed / 観測 / cleanup: 実体は `db/testing/*` (Promise) に閉じ、src の test は `TestDb` service (`src/__tests__/test-db.ts`) 経由、`e2e/fixtures.ts` は直接使う (理由: ADR-0017 の依存注入項)。
- `e2e/fixtures.ts`: spec からは `e2e/seed.ts` の子プロセス経由でのみ呼ぶ。

## 認証ドメインのモデルは repository 経由で触る

`User` / `Session` / `Account` / `Verification` への query は `db/repositories/<entity>.ts` の関数に局所化し、handler から `db.select()` / `db.insert()` を呼ばない。
自前 MFA テーブル (`mfa_totp` / `mfa_recovery_code`) は better-auth が複製しないため、`db/repositories/mfa-totp.ts` 経由の直接 write が正 (ADR-0016)。

`Session` / `User` の削除・更新は repository を作らず `auth.api.signOut` / `auth.api.updateUser` 等の better-auth API で行う。理由: session の実体は TTL store のみで DB に行が無く、user は各 active session の TTL store payload と cookieCache (最大 5 分) に複製されるため、SQL 直操作はこれらに届かない (CONTEXT.md の session)。

## drizzle-kit が管理できない SQL は `drizzle/manual/` に置く

trigger / VIEW / FUNCTION 等の手書き SQL を `drizzle/` 直下に置くと `bun run db:generate` の再生成と衝突する。`drizzle/manual/NNNN_*.sql` を 1 file ずつ足し、`db/migrate-manual.ts` (compose の `auth-migrate`) で適用する。host から `psql` で手動適用しない。

## gotcha

- `db/client.ts` の `pg.Pool` を module singleton にしない。workerd は別 request で開いた socket を再利用できず query がハングする。`db` は単一のまま、中の Pool を `AsyncLocalStorage` で per-request に差し替える (ADR-0011)。
- drizzle に渡す Pool 代替 (`RoutingPool`) は `extends Pool` にする。drizzle は `this.client instanceof Pool` で pool 判定し、満たさないと transaction の BEGIN/COMMIT が別接続に散る。
