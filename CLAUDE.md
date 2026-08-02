# taimei-auth

Web UI / IdP / User・Account・Session DB を 1 サービスに同居させている。将来 identity DB レイヤを別プロセスに切り出せるよう、以下の境界を維持する。コマンド手順 (起動 / compose 操作 / migration / Proto 生成) は [README.md](./README.md) を参照。

サブディレクトリ別ルール:

- `/db/` 配下 → [`db/CLAUDE.md`](./db/CLAUDE.md) — ルール 1 (DB アクセスは `/db/` に閉じる。`/src/` `/web/` から drizzle / `pg` を直接 import しない) / 2 (認証ドメインは repository 経由) / 8 (手書き SQL は `drizzle/manual/` に分離)
- `/packages/auth-client/` 配下 → [`packages/auth-client/CLAUDE.md`](./packages/auth-client/CLAUDE.md) — ルール 7 (SDK を consumer framework に依存させない 5 層 audit)

## ルール 3: consumer app は `@taimei-code/auth-client` 経由のみ

外部 consumer app の窓口は `auth-client` が export する関数と HTTP / Connect RPC エンドポイントだけ。consumer app から `/db/` を import しない・drizzle / `pg` を依存に入れない。consumer 向け新機能は先に `auth-client` 側の API を設計する。別 process 分割時に consumer 側の修正が SDK バージョン上げのみで済む状態を保つ。

## ルール 4: ローカル開発・migration は compose 経由

- migration SQL は `db/schema.ts` 編集 → `db:generate` の生成物 (`drizzle/NNNN_*.sql`) のみ commit。host で `drizzle-kit migrate` を直接叩くと `auth-migrate` service との適用 order が崩れる
- Proto 生成物 `src/gen/` は `generate` script の出力のみ commit (手動編集禁止)
- ホスト側に bun / postgres / redis を直接入れるのは option (README 参照)。原則 compose で完結させる

## ルール 5: build 設定の path 解決は CWD 非依存にする

subdirectory の build 設定 (`web/tailwind.config.ts` / `web/postcss.config.js` 等) の content / include / files 系 path は `import.meta.url` 起点の絶対 path で書く。root から `vite build --config web/vite.config.ts` を走らせるため相対 path は repo root 基準で解決され、`./src/**` は `web/src/` でなく repo の `src/` を指す。Tailwind は silent に空 CSS を出し、lint / typecheck / build:web はいずれも exit 0 のため事後検知できない。

## ルール 6: workspace dep を追加・変更したら Dockerfile も検証する

`workspace:*` 依存を追加・変更したら `docker build .` を 1 回通す。root での typecheck / lint / test / CI は workspace 構造を持つため通り、別 build context (例: taimei 側 e2e の `context: '../taimei-auth'`) で初めて `Workspace dependency not found` が顕在化する。Dockerfile 側の要件:

- deps stage: `COPY packages ./packages` (`bun install` の workspace 解決に必須) + `cd packages/auth-client && bun run build` (handler が dist 経由で型解決するため)
- runner stage: `COPY --from=deps /app/packages ./packages` (node_modules 内 symlink の target)

詳細: `~/.claude/plans/taimei/ADR-006-codebase-slim-down.md` (PR #34 → #35)。

## ルール 9: ドメイン用語・設計判断の SSOT は CONTEXT.md / docs/adr/

plan / 設計メモは恒久保存しない運用のため、後から辿るべきドメイン知識・設計判断の永続化先は次の 2 箇所に限る:

- [`CONTEXT.md`](./CONTEXT.md) — ドメイン用語集 (ubiquitous language)。canonical 用語の定義 + _Avoid_ 語 (使わない同義語)、用語間の Relationships、解消済みの用語曖昧さを記録する。glossary 専用 — 実装詳細・仕様・作業メモは書かない
- [`docs/adr/`](./docs/adr/) — 構造的な設計判断の記録 (Architecture Decision Record)。`NNNN-<slug>.md` の連番。`NNNN-*.analysis.md` は対応 ADR の AC / MECE 分析成果物で、ADR 本文と対で読む

### 参照 (設計・実装・レビュー・文書生成の前に自動で行う)

- コード識別子・UI 文言・PR 説明・コメントの用語は CONTEXT.md の canonical 用語に合わせ、_Avoid_ 語を使わない
- 既存領域 (redirect 検証 / cookie / canary / membership guard / SDK 境界 / workerd 等) を変更する時は該当 ADR を先に読む。コード内コメントや本ファイルの `詳細: docs/adr/NNNN-*.md` 参照が入口

### 更新 (該当する変化が起きたターンで、指示を待たず行う)

- 新しいドメイン用語が確定した / 既存用語との衝突・曖昧さが解消した → CONTEXT.md を既存フォーマット (定義 + _Avoid_ + `詳細: ADR-NNN`) で更新する。domain-modeling スキルが使える環境ではスキル経由で行う
- 「巻き戻し困難 × 文脈なしでは不可解 × 実トレードオフの結果」を全て満たす判断をした → `docs/adr/` に連番 ADR を追加する。3 条件のどれかを欠くなら ADR にしない
- 同じ設計判断の Why 説明が 3+ 箇所のコメント・文書に散りそうになったら、ADR / CONTEXT.md に集約して各所は参照 1 行に留める

## 手動回帰 QA

自動化不能な回帰ケース (cross-subdomain Cookie 実ドメイン / GitHub OAuth 実連携 / workerd 実機 / Resend 実メール / magic link 期限切れ) は [`docs/qa/manual-regression.md`](./docs/qa/manual-regression.md) に QA-MR-* として台帳化している。**該当領域を触る PR のマージ前に、各ケースの「契機」に一致するものを実施する** (本番デプロイ後スモークは QA-MR-01 / QA-MR-03)。ブラウザ実機の認証動線は `bun run test:e2e` (playwright) で自動化済み。

## 既知の落とし穴 (gotcha)

### bun `minimumReleaseAge` で blocked された依存の advisory 更新

- `bunfig.toml` の `minimumReleaseAgeExcludes` は本体だけでなく platform 別 optional binary (`@scope/<os>-<arch>`) も全て明示列挙する。glob は本キーで効かない。漏れると binary が lockfile から落ち、CI の frozen install が fail する
- lockfile 更新は `git checkout main -- bun.lock` を起点に非 clean `bun install` — 当該 family のみ差し替わる。`bun install --force` は fresh な optional binary を再解決せず、lockfile 全再生成は 100+ package の不要 refresh が混入する
- bypass は [`docs/adr/0009-supply-chain-hardening.md`](./docs/adr/0009-supply-chain-hardening.md) §H に従い ADR に記録する (経緯: PR #72)

### Hono: 同 segment 数の static route と `:param` route

static route (`/api/account/companies/add`) を `:param` route (`/api/account/companies/:companyId`) より前に登録する。Hono 4.7 SmartRouter は静的優先ではなく登録順依存 (実測)。後置すると static path が `:companyId="add"` として silent に param handler に吸われる。段数が違う route は競合しない (詳細: `src/handlers/account-company.ts` のコメント / PR #72)。

### workerd: 常駐リソースを request 横断で使い回さない

- module singleton の `pg.Pool` 等を request をまたいで再利用すると、query が resolve も reject もせず "Worker hung" (HTTP 500)。throw でないため `withSentry` も捕捉せず、「Sentry にイベントが来ない」症状に見える
- 対策は fetch ごとに生成し `ctx.waitUntil(resource.close())`。drizzle のような共有 client 層は client を module ロード時に 1 度だけ構築し、中の Pool のみ `AsyncLocalStorage` で per-request に差し替える (`db/client.ts` の `RoutingPool` / [`docs/adr/0011-cloudflare-workers-migration.md`](./docs/adr/0011-cloudflare-workers-migration.md) / PR #91)
- warm isolate が前 request のアイドル接続を掴んだ時のみ間欠再現する。DB を踏む endpoint (`/health` 等) の連打か `wrangler tail` の `outcome:exception` で観測する

### workerd 固有挙動の実機検証は `wrangler dev --remote`

cross-request I/O 制約等は local の `wrangler dev` / miniflare では再現しない。本 worker は custom_domain 運用 (workers.dev subdomain 無効) のため `wrangler versions upload` では preview URL が払い出されず、検証 endpoint を得られない。`wrangler dev --remote` なら working-tree のコードを実 workerd + 実バインディング (Hyperdrive 等) でエフェメラル実行できる。本番トラフィックは無影響 (経緯: PR #91)。

### TypeScript 7 (native compiler)

- `node_modules/@types` の自動 include が廃止。`types` 未指定の tsconfig を新規追加すると `bun:test` / `Bun` / `import.meta.dir` 等の ambient 型が消え TS2304 で fail する。`"types": ["bun"]` を明示する (root と `packages/auth-client` の `tsconfig.json` が実例)
- `baseUrl` は削除済みオプション (TS5102)。`paths` は tsconfig ファイル位置基準で解決されるため `baseUrl: "."` は単純削除でよい
- 型を解決できない side-effect import (`import "./index.css"`) は TS2882 でエラー化。vite 配下は `web/src/vite-env.d.ts` の `/// <reference types="vite/client" />` で解決する
