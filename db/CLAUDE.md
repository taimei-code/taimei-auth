# db/ 境界ルール

## DB アクセスは `db/` に閉じる

drizzle の client、schema、query は `db/` に置き、`src/` `web/` `packages/` から `drizzle-orm` や `pg` を直接 import しない。将来 `db/` を別 process に切り出して RPC 越しに呼ぶためである。
`biome.json` の `noRestrictedImports` が、`src/**` からの `drizzle-orm`・`@/db/schema`・`@/db/client` と、`web/**`・`packages/auth-client/**` からの `drizzle-orm`・`pg` の import を止める。

### 例外 path (正本)

例外の追加は DB 境界の設計変更として review し、`biome.json` も同時に更新する。

- `src/auth.ts`: better-auth が DB adapter と schema を結線する。
- `src/worker.ts`: per-request の pool を供給する `@/db/client` の import だけを許す (`biome-ignore` で個別に許可)。
- テストの seed、観測、cleanup: 実体は `db/testing/*` (Promise) に閉じる。src のテストは `TestDb` service (`src/__tests__/test-db.ts`) を経由し、`e2e/fixtures.ts` は直接使う (理由: ADR-0017 の依存注入の項)。
- `e2e/fixtures.ts`: spec からは `e2e/seed.ts` の子プロセス経由でだけ呼ぶ。
- `testing/server.ts` と、そこから辿る `testing/*` (consumer の試験の環境の entry): 開発用アカウントの seed と一覧、browser ごとの候補の表 (`testing_browser_account`)、session を置く TTL store の表を `db/testing/*` で読み書きする (理由: ADR-0020 の Decision 6・7)。
- `testing/worker.ts` (開発環境と taimei-auth 自身の e2e の entry): 開発用アカウントの行と browser ごとの候補の表を `db/testing/*` で足し、開発者ホームから読み書きする (理由: ADR-0020 の Decision 7)。

試験が `DATABASE_URL` の向き先を判定するのは `db/testing/local-database.ts` の `databaseTarget` だけである (`db/__tests__/containment.test.ts` が固定)。

## 認証ドメインのモデルは repository 経由で触る

`User` / `Session` / `Account` / `Verification` への query は `db/repositories/<entity>.ts` の関数に局所化し、handler から `db.select()` や `db.insert()` を呼ばない。
自前の MFA テーブル (`mfa_totp` / `mfa_recovery_code`) は better-auth が複製しないため、`db/repositories/mfa-totp.ts` 経由で直接 write するのが正しい (ADR-0016)。

`Session` / `User` の削除と更新は repository を作らず、`auth.api.signOut` や `auth.api.updateUser` などの better-auth API で行う。session の実体は TTL store だけにあって DB に行が無く、user は各 active session の TTL store payload に複製されているため、SQL を直接操作してもこれらには届かないからである (GLOSSARY.md の session)。

## drizzle-kit が管理できない SQL は `drizzle/manual/` に置く

trigger、VIEW、FUNCTION などの手書き SQL を `drizzle/` 直下に置くと、`bun run db:generate` の再生成と衝突する。`drizzle/manual/NNNN_*.sql` を 1 ファイルずつ足し、`db/migrate-manual.ts` (compose の `auth-migrate`) で適用する。host から `psql` で手動適用しない。
`db/migrate-manual.ts` は起動と deploy のたびに全 file を流す。そのため `drizzle/manual/` には何度流しても結果が同じ DDL と修復だけを置く。一度だけのデータ移行はここに置かず、`management/` の script にする (ADR-0010)。新規登録の途中で所属の無い利用者に事業所を作らないことを `db/__tests__/manual-sql.test.ts` が固定する。

## gotcha

- `db/client.ts` の `pg.Pool` を module singleton にしない。workerd は別の request で開いた socket を再利用できず、query がハングする。`db` は単一のまま、中の Pool を `AsyncLocalStorage` で request ごとに差し替える (ADR-0011)。
- drizzle に渡す Pool の代替 (`RoutingPool`) は `extends Pool` にする。drizzle は client が pool かどうかを instance (`instanceof Pool`) か class 名 (`Pool` を含むか) で判定し、pool と見なさない client では transaction の BEGIN と COMMIT と中の query が別の接続に散る。`db/__tests__/client.test.ts` が、transaction の中で同時に投げた query が同じ接続で走ることを確かめる。
