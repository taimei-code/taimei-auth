# db/ 境界ルール

`/db/` 配下を編集する時に守るルール。root `CLAUDE.md` の境界 framework から派生し、本 dir 配下を編集するセッションで context-aware に load される。

---

## ルール 1: DB アクセスは `/db/` 配下に閉じる

drizzle の client / schema / クエリ実装は `/db/` 配下に置く。`/src/` `/web/` `/packages/` から `drizzle-orm` や `pg` を直接 import しない。

- `/db/client.ts` … pg クライアント生成
- `/db/schema.ts` … テーブル定義
- `/db/repositories/<entity>.ts` … クエリ関数 (ルール 2)

`/db/` を別プロセスに剥がして RPC 越しに呼ぶ形にすることが将来の分離方法。`/db/` の外から drizzle に触らせない。

`src/rpc/*` 配下からの `drizzle-orm` / `@/db/schema` / `@/db/client` import は `biome.json` の `noRestrictedImports` で機械的に block される (ADR-006 D2)。

## ルール 2: 認証ドメインのモデルは repository 経由でのみ触る

`User` / `Session` / `Account` / `Verification` などのテーブルに対して、handler や RPC handler から `db.select()` / `db.insert()` を直接呼ばない。

正しい形:

```ts
// /db/repositories/user.ts
export async function findUserByEmail(email: string) { ... }
export async function updateUserName(id: string, name: string) { ... }

// /src/rpc/user-handler.ts
import { findUserByEmail } from "../../db/repositories/user";
```

禁止:

```ts
// /src/rpc/user-handler.ts
import { db } from "../../db/client";
import { user } from "../../db/schema";
const rows = await db.select().from(user).where(...);  // NG
```

剥がすときに置き換える対象を repository 関数に局所化する。better-auth の internal 利用 (`/src/auth.ts`) は例外として schema に直接触ってよい。

例外: `Session` / `User` の **削除・更新** は better-auth が `secondaryStorage` (Redis cookieCache, `src/auth.ts:106` `maxAge: 5*60`) と DB を二重保管するため、`db/repositories/<entity>.ts` を作って repository 経由にすると最大 5 分の窓で stale session が cookieCache hit で valid に見える。`auth.api.signOut({ headers })` / `auth.api.updateUser` 等の better-auth API 経由で行い、cache invalidation を lifecycle hook に委ねる。`Session` repository を作らないのはこの理由。詳細: `~/.claude/plans/taimei/ADR-006-codebase-slim-down.md` (D2)

## ルール 8: drizzle-kit が管理できない SQL は `drizzle/manual/` に分離する

PL/pgSQL trigger / VIEW / FUNCTION / custom DDL など、`db/schema.ts` のスキーマ差分から drizzle-kit が再生成できない手書き SQL は `drizzle/manual/NNNN_*.sql` に置く。`drizzle/0000_*.sql` などの auto-managed migration と同じディレクトリには置かない。

理由: drizzle-kit は `drizzle/` 配下を生成物として扱う。手書き SQL を `drizzle/` 直下に置くと、`db/schema.ts` 変更で `bun run db:generate` を走らせた時に再生成衝突 / 意図しない差分検知が起きる。`drizzle/manual/` への隔離で再生成境界を物理的に分離する。

適用フロー:
- compose の `auth-migrate` service が `bun run db:migrate && bun run db:migrate-manual` の順で実行 (`docker-compose.yml:55`)
- `db/migrate-manual.ts` が `drizzle/manual/*.sql` を `db.transaction` 内で順次適用
- 複数 file の部分適用を防ぐため transaction 内に閉じている (例: `0001` 成功 / `0002` 失敗で全 rollback)

新規 trigger SQL を追加する場合は `drizzle/manual/NNNN_*.sql` を 1 ファイルずつ append し、host で `drizzle-kit migrate` や `psql` で手動適用せず compose 再起動で `auth-migrate` を経由させる (root CLAUDE.md ルール 4 と整合)。

詳細: `~/.claude/plans/taimei/ADR-001-auth-separation.md` Phase 1.5 retrospective (R1 user.revision DB trigger の導入経緯)。
