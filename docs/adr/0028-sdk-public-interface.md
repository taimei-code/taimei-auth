# ADR-0028: SDK の公開 interface を consumer の framework に依存させない

## Status

Accepted (2026-11-10)。判断主体は maintainer。実装は taimei-code/taimei-auth#431。`packages/auth-client/CLAUDE.md` にあった 5 層の表と、禁止する package の一覧 (`.oxlintrc.json` と `sdk-boundary-ban.test.ts`) を置き換える。[ADR-0006](./0006-sdk-encapsulation.md) を補う。

## Context

root の境界は consumer から SDK への向きを制限する。逆向きの依存 (SDK が Next.js・React・Node に暗黙に依存すること) は、`import` が 0 件でも、型・shape・runtime API に残る。

これまでの仕組みは、禁止する package 11 個の列挙 (lint) と、その写し (test) だった。列挙に無い package は通った。SDK の src に `effect` と `hono` の型の import を足すと、lint も build も通り、`dist` に入った (root の `node_modules` が解決する)。Node と Bun の global (`process`・`Buffer`・`Bun`) も型エラーにならなかった。残りは「interface を足す時に 5 層を目視で audit する」という文だった。

## Decision

1. SDK の src が import できる外部 package は、`packages/auth-client/package.json` の `peerDependencies` だけである。lint の行が型だけの import も含めて止める (型は `.d.ts` に出る)。import できる package を決める一覧は `peerDependencies` の 1 つだけにする
2. SDK の build (`tsconfig.build.json`) は `"types": []`・`"lib": ["ES2023", "DOM"]` で行う。`process`・`Buffer`・`Bun`・`node:*` は型エラーになる。`fetch` と `URL` を使うので DOM は要る
3. 公開の `.d.ts` (`gen/` を除く) の写しを `packages/auth-client/api/` に commit する。SDK の test が `dist` と比べ、違えば落ちる。`bun run --cwd packages/auth-client api` で写しを更新すると、公開 interface の差分が PR の diff に出る。`api/` は publish しない。`gen/` の形は `buf breaking` が見る
4. `api/` の差分は次の 5 層で読む

| 層 | lock-in の兆候 | 中立化の方針 | 仕組み |
|---|---|---|---|
| 1. 型シグネチャ | `cache: <T extends (...args: any[]) => any>(fn: T) => T` (React.cache の形) | optional にして default を identity とし、注入は consumer に委ねる | `api/` の差分を読む |
| 2. 戻り型 | `redirect: (url) => never` (Next.js の throw 前提) | 副作用 callback を持たず、consumer に `getSession()` の戻り値で分岐させる | test が `=> never` を止める。ほかは `api/` の差分を読む |
| 3. データ shape | `CookieReader { get(name): { value: string } }` (Next.js `cookies()` 専用) | 最大公約数の `(name) => string \| undefined` で受ける | `api/` の差分を読む (判定する仕組みは無い) |
| 4. runtime API | `@connectrpc/connect-node` の hardcode と peerDeps | transport は `createAuthClient({ transport })` で注入する | Decision 1・2 |
| 5. URL / path | consumer の login の入口など、consumer 固有の path のハードコード | consumer が持つ path は consumer 側の helper が組む。taimei-auth が持つ画面の URL は SDK が組む | consumer の名前・host・path が出ないことを SDK の test が見る |

5. `src/testing.ts` の相対 import は `.js` まで書く。consumer の e2e は `@taimei-code/auth-client/testing` を bundler を通さずに Node で読み、Node の ESM は拡張子の無い相対 import を解決できない。この repo の試験は Bun で走り、拡張子が無くても解決するので、誤りは試験では見つからない。静的な import と re-export の拡張子は lint (`import/extensions`) が、動的な `import()` と `.ts` の拡張子は `tsconfig.testing-node.json` (`nodenext`) の typecheck が止める。この package は `"type": "module"` を書いていないので、TS は静的な import の拡張子を求めない。そのため両方が要る

## Considered Options

| 案 | 選ばなかった理由 |
|---|---|
| 禁止する package を列挙する (今まで) | 一覧に無い package が通る。lint・test・`peerDependencies` の 3 つを人が同期する |
| build した `dist` の import を `peerDependencies` と比べる test | 止まるのが `bun test` まで遅れる。lint の行なら、エディタで出る |
| package を `"type": "module"` + `nodenext` にそろえ、`.js` の規則を typecheck だけで止める | consumer から見える変更になる |

## Consequences

- `api/` は差分を見せるだけで、lock-in かどうかは review が決める。層 3 を判定する仕組みは無い
- SDK の公開の型を変えた PR は、`api/` の更新を含む
