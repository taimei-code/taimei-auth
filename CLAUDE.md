# taimei-auth

Web UI / IdP / User・Account・Session DB を 1 サービスに同居させている。将来的に identity DB レイヤを別プロセスに切り出せるよう、以下の境界を維持する。

---

## ルール 1: DB アクセスは `/db/` 配下に閉じる

drizzle の client / schema / クエリ実装は `/db/` 配下に置く。`/src/` `/web/` `/packages/` から `drizzle-orm` や `pg` を直接 import しない。

- `/db/client.ts` … pg クライアント生成
- `/db/schema.ts` … テーブル定義
- `/db/repositories/<entity>.ts` … クエリ関数(ルール 2)

`/db/` を別プロセスに剥がして RPC 越しに呼ぶ形にすることが将来の分離方法。`/db/` の外から drizzle に触らせない。

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

剥がすときに置き換える対象を repository 関数に局所化する。better-auth の internal 利用(`/src/auth.ts`)は例外として schema に直接触ってよい。

## ルール 3: consumer app からは必ず `@taimei-code/auth-client` 経由で話す

外部 consumer app は taimei-auth の DB / 内部 RPC / 内部関数を共有しない。窓口は以下のみ:

- `@taimei-code/auth-client` が export する関数
- taimei-auth の HTTP / Connect RPC エンドポイント

具体的には:

- consumer app から `/db/` の関数を import するコードを書かない・受け入れない
- consumer app に drizzle や `pg` を依存に含めない
- 新しい consumer 向け機能は、まず `packages/auth-client/` 側の API として設計してから taimei-auth 側を実装する

taimei-auth を別 process に分割しても、consumer 側の修正は `auth-client` のバージョン上げのみで済む状態を維持する。
