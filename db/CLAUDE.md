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
