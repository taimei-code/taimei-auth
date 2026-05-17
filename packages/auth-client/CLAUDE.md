# packages/auth-client/ 境界ルール

`@taimei-code/auth-client` SDK の公開 API を編集する時に守るルール。root `CLAUDE.md` の境界 framework から派生し、本 dir 配下を編集するセッションで context-aware に load される。

---

## ルール 7: SDK の公開 API は consumer framework に依存させない

`packages/auth-client/` の interface を追加・変更する時は、以下の **5 層** を audit して特定 framework (Next.js / React / Node 等) に lock-in していないか確認する。`import "next/*"` / `import "react"` の grep が 0 件でも、型・shape・runtime API レベルで暗黙依存が残るため別途検査が必要。

| 層 | 検査対象 | lock-in の sign | 中立化方針 |
|---|---|---|---|
| 1. 型シグネチャ | callback 型の generic / wrap シグネチャ | `cache: <T extends (...args: any[]) => any>(fn: T) => T` (React.cache 形) | optional + default identity (`(fn) => fn`) で consumer に注入を委ねる |
| 2. 戻り型 | callback の戻り型に `never` の有無 | `redirect: (url) => never` (Next.js NEXT_REDIRECT throw 前提) | 副作用 callback は SDK に持たせず consumer 側で `getSession()` の戻り値分岐で書かせる |
| 3. データ shape | interface の返却 shape | `CookieReader { get(name): { value: string } }` (Next.js `cookies()` 専用) | 最大公約数の関数型 `(name) => string \| undefined` で受ける |
| 4. runtime API | 内部 import / peerDependencies | `@connectrpc/connect-node` を SDK 内 hardcode + peerDeps 要求 | transport は consumer 注入 (`createAuthClient({ transport })`)、Edge / Workers / Bun fetch も動く |
| 5. URL / path 規約 | consumer 固有 path のハードコード | `buildLoginRedirectPath = "/auth?callbackUrl=..."` (taimei の login path) | path 構築は consumer 側 helper で行い、SDK は session contract のみ提供 |

`packages/auth-client/biome.json` の `style.noRestrictedImports` で `next/*` / `react` / `@connectrpc/connect-node` を ban しているのは層 4 の機械的防壁。層 1-3 / 5 は lint で検出困難なため、SDK API 追加時に本ルールを参照して目視 audit する。

理由: root `CLAUDE.md` ルール 3 は「consumer → SDK のみ依存」を強制するが、逆方向 (「SDK → consumer framework に暗黙依存」) は別の壁。SDK が Next.js 専用に見えていなかったのに 5 層で lock-in していた前例 (ADR-007 §現状調査の L1-L5) があり、grep だけでは検出できない。`taimei-auth` を別 process 化しても consumer 側修正が auth-client バージョン上げのみで済む (ルール 3 末尾) には、SDK 側が framework 中立である前提が必須。

詳細: `~/.claude/plans/taimei/ADR-007-auth-client-framework-agnostic.md` (PR #41 の経緯)。
