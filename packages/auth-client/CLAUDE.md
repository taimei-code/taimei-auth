# packages/auth-client/ 境界ルール

## ルール 7: SDK の公開 API は consumer framework に依存させない

root の「共通境界」は consumer → SDK の方向を縛る。逆方向 (SDK が Next.js / React / Node に暗黙依存) は `import` の grep が 0 件でも型・shape・runtime API に残るため、interface を追加・変更する時は次の 5 層を目視 audit する。

| 層 | lock-in の sign | 中立化方針 |
|---|---|---|
| 1. 型シグネチャ | `cache: <T extends (...args: any[]) => any>(fn: T) => T` (React.cache 形) | optional + default identity で consumer に注入を委ねる |
| 2. 戻り型 | `redirect: (url) => never` (Next.js の throw 前提) | 副作用 callback を持たず、consumer に `getSession()` の戻り値で分岐させる |
| 3. データ shape | `CookieReader { get(name): { value: string } }` (Next.js `cookies()` 専用) | 最大公約数の `(name) => string \| undefined` で受ける |
| 4. runtime API | `@connectrpc/connect-node` の hardcode + peerDeps | transport は `createAuthClient({ transport })` で注入 |
| 5. URL / path | `"/auth?callbackUrl=..."` 等の consumer 固有 path | path 構築は consumer 側 helper、SDK は session contract のみ |

層 4 だけは root `biome.json` の `packages/auth-client/**` override が ban し、`src/__tests__/sdk-boundary-ban.test.ts` が集合を固定する。

`effect` は `src/errors.ts` の `Data.TaggedError` だけが使う `dependencies` で、汎用 library なので ban 対象外。外すと `./errors` の class の runtime 形が変わり breaking なので、外すなら次の major に同梱する。
