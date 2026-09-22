# db/ 境界ルール

## DB アクセスは `db/` に閉じる

drizzle の client、schema、query は `db/` に置き、`src/` `web/` `packages/` から `drizzle-orm` や `pg` を直接 import しない。将来 `db/` を別 process に切り出して RPC 越しに呼ぶためである。
`src/**` からの import は `biome.json` の `noRestrictedImports` が止める。`web/` と `packages/` は lint が止めないので review で守る。

### 例外 path (正本)

例外の追加は DB 境界の設計変更として review し、`biome.json` も同時に更新する。

- `src/auth.ts`: better-auth が DB adapter と schema を結線する。
- `src/worker.ts`: per-request の pool を供給する `@/db/client` の import だけを許す (`biome-ignore` で個別に許可)。
- テストの seed、観測、cleanup: 実体は `db/testing/*` (Promise) に閉じる。src のテストは `TestDb` service (`src/__tests__/test-db.ts`) を経由し、`e2e/fixtures.ts` は直接使う (理由: ADR-0017 の依存注入の項)。
- `e2e/fixtures.ts`: spec からは `e2e/seed.ts` の子プロセス経由でだけ呼ぶ。

## 認証ドメインのモデルは repository 経由で触る

`User` / `Session` / `Account` / `Verification` への query は `db/repositories/<entity>.ts` の関数に局所化し、handler から `db.select()` や `db.insert()` を呼ばない。
自前の MFA テーブル (`mfa_totp` / `mfa_recovery_code`) は better-auth が複製しないため、`db/repositories/mfa-totp.ts` 経由で直接 write するのが正しい (ADR-0016)。

`Session` / `User` の削除と更新は repository を作らず、`auth.api.signOut` や `auth.api.updateUser` などの better-auth API で行う。session の実体は TTL store だけにあって DB に行が無く、user は各 active session の TTL store payload と cookieCache (最大 5 分) に複製されているため、SQL を直接操作してもこれらには届かないからである (CONTEXT.md の session)。

## drizzle-kit が管理できない SQL は `drizzle/manual/` に置く

trigger、VIEW、FUNCTION などの手書き SQL を `drizzle/` 直下に置くと、`bun run db:generate` の再生成と衝突する。`drizzle/manual/NNNN_*.sql` を 1 ファイルずつ足し、`db/migrate-manual.ts` (compose の `auth-migrate`) で適用する。host から `psql` で手動適用しない。

## gotcha

- `db/client.ts` の `pg.Pool` を module singleton にしない。workerd は別の request で開いた socket を再利用できず、query がハングする。`db` は単一のまま、中の Pool を `AsyncLocalStorage` で request ごとに差し替える (ADR-0011)。
- drizzle に渡す Pool の代替 (`RoutingPool`) は `extends Pool` にする。drizzle は `this.client instanceof Pool` で pool かどうかを判定し、満たさないと transaction の BEGIN/COMMIT が別の接続に散る。
