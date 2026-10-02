# packages/auth-client/ 境界ルール

## ルール 7: SDK の公開 API は consumer framework に依存させない

root の「共通境界」は consumer から SDK への方向を制限する。逆方向の依存 (SDK が Next.js / React / Node に暗黙に依存すること) は、`import` の grep が 0 件でも型、shape、runtime API に残るため、interface を追加・変更する時は次の 5 層を目視で audit する。

| 層 | lock-in の兆候 | 中立化の方針 |
|---|---|---|
| 1. 型シグネチャ | `cache: <T extends (...args: any[]) => any>(fn: T) => T` (React.cache の形) | optional にして default を identity とし、注入は consumer に委ねる |
| 2. 戻り型 | `redirect: (url) => never` (Next.js の throw 前提) | 副作用 callback を持たず、consumer に `getSession()` の戻り値で分岐させる |
| 3. データ shape | `CookieReader { get(name): { value: string } }` (Next.js `cookies()` 専用) | 最大公約数の `(name) => string \| undefined` で受ける |
| 4. runtime API | `@connectrpc/connect-node` の hardcode と peerDeps | transport は `createAuthClient({ transport })` で注入する |
| 5. URL / path | `"/auth?callbackUrl=..."` などの consumer 固有の path | path の構築は consumer 側の helper が行い、SDK は session contract だけを持つ |

層 4 だけは root `biome.json` の `packages/auth-client/**` override が禁止し、root の `src/__tests__/sdk-boundary-ban.test.ts` が禁止対象の集合を固定する。
