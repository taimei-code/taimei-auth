# taimei-auth

Web UI / IdP / User・Account・Session DB を 1 サービスに同居させている。将来的に identity DB レイヤを別プロセスに切り出せるよう、以下の境界を維持する。

ローカル起動・compose 操作・スキーマ migration・Proto 生成のコマンド手順は [README.md](./README.md) を参照。本ファイルには境界ルールと、過去に手戻りした既知の落とし穴を記載し、How (コマンド) は README 側に集約する。

## サブディレクトリ別ルール

| 編集対象 | 参照する CLAUDE.md | 含むルール |
|---|---|---|
| `/db/` 配下 (drizzle / repository) | [`db/CLAUDE.md`](./db/CLAUDE.md) | ルール 1 (DB アクセスは `/db/` に閉じる) / ルール 2 (repository 経由) / ルール 8 (drizzle 手書き SQL は `drizzle/manual/` に分離) |
| `/packages/auth-client/` 配下 (SDK 公開 API) | [`packages/auth-client/CLAUDE.md`](./packages/auth-client/CLAUDE.md) | ルール 7 (SDK は consumer framework に依存させない 5 層 audit) |

subdirectory の CLAUDE.md は該当 dir 配下を編集するセッションで context-aware に load される。本ファイル (root) は repo 全体の境界ルール (3-6) を扱う。

---

## ルール 3: consumer app からは必ず `@taimei-code/auth-client` 経由で話す

外部 consumer app は taimei-auth の DB / 内部 RPC / 内部関数を共有しない。窓口は以下のみ:

- `@taimei-code/auth-client` が export する関数
- taimei-auth の HTTP / Connect RPC エンドポイント

具体的には:

- consumer app から `/db/` の関数を import するコードを書かない・受け入れない
- consumer app に drizzle や `pg` を依存に含めない
- 新しい consumer 向け機能は、まず `packages/auth-client/` 側の API として設計してから taimei-auth 側を実装する

taimei-auth を別 process に分割しても、consumer 側の修正は `auth-client` のバージョン上げのみで済む状態を維持する。

## ルール 4: ローカル開発・migration は compose 経由で行う

起動 / watch / rebuild / log / DB 接続 / スキーマ変更 / Proto 生成は README.md の手順に従う (具体的コマンドは README 参照)。特に守ること:

- スキーマ変更時は `db/schema.ts` 編集 → `db:generate` で生成された `drizzle/NNNN_*.sql` を commit するフロー以外で migration SQL を手書きしない。compose 起動時に `auth-migrate` service が適用するため、host で `drizzle-kit migrate` を直接叩くと order が崩れる
- Proto 生成物 (`src/gen/`) は手動編集せず、`generate` script の出力のみを commit する。`buf.gen.yaml` 経由で再現性を保つ
- ホスト側に bun / postgres / redis を直接入れる手順 (README の "ホスト側で bun を直接動かす" 節) は option。原則 compose のみで完結させる

## ルール 5: Build 設定の path 解決は CWD 非依存にする

`web/tailwind.config.ts` / `web/postcss.config.js` のように subdirectory に置いた build 設定ファイルでは、content / include / files 系の相対 path を使わず `path.dirname(fileURLToPath(import.meta.url))` 起点の絶対 path で書く。

理由: 本リポジトリは root から `vite build --config web/vite.config.ts` を走らせるため、相対 path は CWD = repo root 起点で解決される。`./src/**` と書くと `web/src/` ではなく repo の `src/` を見に行き、Tailwind なら class が一切 scan されない silent な空 CSS になる。`bun run lint` `bun run typecheck` `bun run build:web` はいずれも exit 0 で完走するため事後検知できない。設定段階で絶対 path 化して防ぐ。

## ルール 6: workspace dep を追加・変更したら Dockerfile も検証する

`package.json` の `dependencies` に `"@taimei-code/auth-client": "workspace:*"` 形式の workspace 参照を追加・変更したら、CI workflow の SDK build step に加えて **Dockerfile の deps stage でも `packages/` を `COPY` し SDK を pre-build する**こと。手元で `docker build .` を 1 回実行して通ることを確認する。

理由: `bun install` は workspace dep を解決するために `packages/<name>/package.json` を見に行く。Dockerfile の `deps` stage が `COPY package.json bun.lock* ./` のみだと `Workspace dependency "<name>" not found` で失敗する。`bun run typecheck` / `lint` / `test` / CI の Lint workflow / Test workflow は workspace 構造を root に持つため通るが、別 build context (例: taimei 側 e2e の `context: '../taimei-auth'`) で初めて顕在化する。詳細: `~/.claude/plans/taimei/ADR-006-codebase-slim-down.md` (PR #34 → fix #35 の経緯)。

具体的に追加すべき記述 (Dockerfile):
```dockerfile
FROM base AS deps
COPY package.json bun.lock* ./
COPY packages ./packages              # workspace 解決のため必須
RUN bun install
RUN cd packages/auth-client && bun run build  # handler が dist 経由で型解決するため

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages   # symlink target が必要
...
```

---

## 既知の落とし穴 (gotcha)

境界ルールではないが、過去に手戻りした運用上の罠。

### bun の `minimumReleaseAge` で blocked された依存を advisory 修正のため上げるとき

- `bunfig.toml` の `minimumReleaseAgeExcludes` には**パッケージ本体だけでなく platform 別 optional binary (`@scope/<os>-<arch>`) も全て明示列挙**する。glob (`@esbuild/*`) は本キーで効かない。本体だけ除外すると binary が lockfile から落ち、CI の frozen install が「`@esbuild/linux-x64 could not be found`」で落ちる
- `bun install --force` は既存 lockfile に fresh な optional binary を再解決して入れない。`rm -r node_modules bun.lock` の全再生成は range 内で 100+ package を refresh する (auth ライブラリ等の minor bump が混入)。**旧 binary を持つ lockfile を `git checkout main -- bun.lock` で起点に置いてから非 clean `bun install`** すると、当該 family のみ差し替わり他 package の不要 refresh を避けられる
- bypass は [`docs/adr/0009-supply-chain-hardening.md`](./docs/adr/0009-supply-chain-hardening.md) §H の運用に従い ADR に記録する

理由: esbuild 0.28.1 (GHSA-gv7w-rqvm-qjhr 修正) が release 2 日で、本体除外 → binary 欠落 → glob 無効 → `--force` 無効 → 全再生成は過大、と 6 手戻りした。最終解が main lockfile 起点の非 clean install による family 限定差し替え (詳細: PR #72)。

### Hono で同 segment 数の static route と `:param` route が共存するとき

- static route (`/api/account/companies/add`) を `:param` route (`/api/account/companies/:companyId`) より**前に登録**する。Hono 4.7 SmartRouter は静的優先ではなく**登録順依存**で、後に置くと static path が `:companyId="add"` として param handler に silent に吸われる

理由: 机上で「静的優先」と誤 assume したが、使い捨て検証コードで実測したら登録順依存だった。段数が違う route (`/:companyId/delete`) は param と競合しない (詳細: `src/handlers/account-company.ts` のコメント / PR #72)。

### Workers (workerd) で per-request しか持てないリソースを isolate 横断で使い回さない

- `pg.Pool` 等の常駐 TCP 接続を module singleton にして request をまたいで再利用すると、workerd は別 request の I/O コンテキストで開いた socket を再利用できず、query が resolve も reject もせず **"Worker hung"** (HTTP 500) になる。throw でないため `withSentry` も捕捉せず **Sentry にも飛ばない**(症状が「Sentry にイベントが来ない」に見える)
- 対策: Cloudflare 公式どおり fetch ごとにリソースを生成し `ctx.waitUntil(resource.close())` で閉じる。drizzle のように単一 client を共有する層は、client は module ロード時に 1 度だけ構築し、中の Pool だけを `AsyncLocalStorage` で per-request に差し替える (詳細: `db/client.ts` の `RoutingPool` / `docs/adr/0011-cloudflare-workers-migration.md` / PR #91)
- 間欠的に出る (warm isolate が前 request のアイドル接続を掴んだ時だけ) ため、`/health` 等 DB を踏む endpoint の連打 or `wrangler tail` の `outcome:exception` で再現・観測する

理由: 「Sentry にイベントが飛ばない」調査から入ったが、真因は singleton `pg.Pool` の cross-request 再利用による hung だった。env (`SENTRY_DSN` 等) からは原因が出ず、`wrangler tail` の hung 例外と本番 `/health` 連打 (7-8/8 が 500) で確定した (詳細: PR #91)。

### workerd 固有挙動の検証は `wrangler dev --remote` を使う (`versions upload` は preview URL が出ない)

- 上記のような workerd 固有の挙動 (cross-request I/O 制約等) は local の `wrangler dev` / miniflare では再現しないため、実 workerd + 実バインディング (Hyperdrive 等) で検証する必要がある
- 本 worker は `custom_domain` 運用 (workers.dev subdomain 無効) のため、`wrangler versions upload` で 0% version を上げても **preview URL が払い出されない** (`wrangler versions view` でも出ない)。検証用 endpoint が得られず詰む
- 代わりに `wrangler dev --remote` を使う: working-tree のコードをエッジでエフェメラル実行し (version 履歴に残らない)、`localhost` 経由で実 Hyperdrive 等を叩ける。本番トラフィックは無影響。`/health` 連打等で fix を実測する

理由: 修正の実機検証で `wrangler versions upload` を実行したが preview URL が出ず (custom_domain で workers.dev preview 無効)、`wrangler dev --remote` に切替えて実 workerd 上で `/health` 30/30 hung 0 を確認できた (詳細: PR #91)。
