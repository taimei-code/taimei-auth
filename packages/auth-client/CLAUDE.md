# packages/auth-client/ 境界ルール

## SDK の公開 API は consumer framework に依存させない

root の「共通境界」は consumer から SDK への方向を制限する。逆方向の依存 (SDK が Next.js / React / Node に暗黙に依存すること) は、`import` の grep が 0 件でも型、shape、runtime API に残るため、interface を追加・変更する時は次の 5 層を目視で audit する。

| 層 | lock-in の兆候 | 中立化の方針 |
|---|---|---|
| 1. 型シグネチャ | `cache: <T extends (...args: any[]) => any>(fn: T) => T` (React.cache の形) | optional にして default を identity とし、注入は consumer に委ねる |
| 2. 戻り型 | `redirect: (url) => never` (Next.js の throw 前提) | 副作用 callback を持たず、consumer に `getSession()` の戻り値で分岐させる |
| 3. データ shape | `CookieReader { get(name): { value: string } }` (Next.js `cookies()` 専用) | 最大公約数の `(name) => string \| undefined` で受ける |
| 4. runtime API | `@connectrpc/connect-node` の hardcode と peerDeps | transport は `createAuthClient({ transport })` で注入する |
| 5. URL / path | consumer の login の入口など、consumer 固有の path のハードコード | consumer が持つ path は consumer 側の helper が組む。taimei-auth が持つ画面の URL (`buildAuthLoginUrl`・`buildAuthErrorUrl` など) は SDK が組む |

層 4 だけは root `biome.json` の `packages/auth-client/**` override が禁止し、root の `src/__tests__/sdk-boundary-ban.test.ts` が禁止対象の集合を固定する。

## SDK は taimei-auth の決めごとだけを持ち、consumer の知識を持たない

依存の向きは consumer → SDK → taimei-auth の一方向である。SDK の code、試験、README、CHANGELOG に、consumer の名前、host、path、consumer が画面を使う目的を書かない。名前は taimei-auth の画面や値から付け、試験の値は `example-service` や `app.example` のような中立の値にする。root の `src/__tests__/sdk-consumer-knowledge.test.ts` が、consumer の名前・host・login の path が出てこないことを確かめる。

## 試験の環境の compose の断片は release で生成し、digest の無い断片を publish しない

repo に置くのは template の `testing/compose.template.yml` だけである。publish の workflow が試験用の image を push した後に、`scripts/generate-testing-fragment.sh` でその digest を埋めた `testing/compose.yml` を生成する。生成した断片が git の対象外で package に入ること、digest の無い断片では `prepublishOnly` が build の前に止まること、断片が `TAIMEI_AUTH_*` 以外の変数を参照しないことは、root の `src/__tests__/testing-fragment.test.ts` が確かめる。
