# ADR-0014: Docker image を本番相当 runner と full-toolchain dev に分離し、既定 target は dev を維持する

## Status

Accepted (2026-08-09)。`chore/prod-deps-separation` ブランチで実装した。

[ADR-0019](./0019-ttl-store-durable-objects.md) (2026-09-20) が runner stage と prod-deps stage を撤去した。
この ADR のうち撤回されたのはその 2 つの stage に関する部分 (prod-deps への分岐、runner を compose で常時使う項、
runner に無い dev ツールのための stage 選択) だけで、以下の本文は撤回後の形に書き換えてある。
Decision 1 の依存分類は「本番 runtime の契約」ではなくなり、「server コードが import してよい package を保つための衛生」
として残る (理由は ADR-0019 の Decision「runner stage を撤去」と Consequences に書いた)。
Context は当時の実測として残す。

## Context

PR #136 の /code-review で「`qrcode` を devDependencies へ移す」という提案が出た。しかし当時の Dockerfile は
runner へ node_modules を丸ごと COPY しており (`--production` での install をしていない)、package を移すだけでは
image から何も消えないため見送った。根本には 2 つの問題があった。

- `dependencies` セクションが「本番 runtime の契約」として不正確だった。web bundle にしか使われない
  package が 13 件混在しており、advisory 対応 (ADR-0009 の minimumReleaseAge 運用) のたびに
  「この依存はサーバで動くのか」を調べ直していた
- runner image が devDependencies を丸ごと含み、node_modules が 874MB、image が 1.03GB あった

前提として、この Docker image を使うのはローカルの compose と taimei 側の e2e
(`../taimei/docker-compose.e2e.yml`) の 2 つだけである。本番は wrangler bundle (ADR-0011) で、image は
本番には配布しない。それでも「本番相当の依存だけで server が動く」ことを常時検証できる場が
ローカルの compose しかないため、分類の正確さと image の中身の正確さには実利がある。

設計を制約した実測の事実は次のとおりである。

- **taimei 側の e2e はこの Dockerfile を build し、`bunx drizzle-kit migrate` を実行する**
  (`docker-compose.e2e.yml` の `e2e-auth-service`)。taimei #533 で `target: dev` を pin 済みだが、
  位置契約 (既定 target が最終 stage であり、それが dev であること) は、pin を持たない consumer に対する
  多層防御として維持する (検証方法は下記 Consequences)
- README の codegen の手順 (`db:generate` / `generate`) は drizzle-kit と @bufbuild/buf という
  devDependencies の binary を前提にする
- `bun install --frozen-lockfile --ignore-scripts --production` は**既存の full node_modules を
  prune しない** (deps stage 上で実測したところ lucide-react が残った)。そのため `FROM deps` から派生する prod stage は
  成立せず、`FROM base` からの独立した install が必要である
- `.dockerignore` の root-anchor なパターン (`**/` が前置されておらず、build context 直下にしか一致しない
  `node_modules` / `dist`) は `packages/auth-client/dist` に一致しない。そのため runner の `COPY . .` が、
  deps stage で build した新しい dist を host の古い dist で上書きしていた (5 月時点の
  産物が image に入っていたことを mtime で実測した)

## Decision

1. **依存分類は「server コードが import してよい package を保つための衛生」とする** (当初は「本番 runtime の契約」だった。Status 参照)。web 専用の 13 件 (`@radix-ui/*` 5 件 / `class-variance-authority`
   / `clsx` / `lucide-react` / `qrcode` / `react-router-dom` / `sonner` / `tailwind-merge` /
   `tailwindcss-animate`) を devDependencies へ移動し、import の無い `@connectrpc/connect-node` を
   削除する。既存の biome の ban は `packages/auth-client/**` の scope だけだったため、root の override
   (`src/**` / `db/**` / `management/**`) に 13 件と connect-node の `noRestrictedImports` を追加して
   分類を import の時点で強制する。`react` / `react-dom` は src/email の server 実行時の
   描画で必要なため dependencies に残す (dynamic import で実行時に react を読み込む理由: [ADR-0011](./0011-cloudflare-workers-migration.md)「本番デプロイで発見した workerd 固有 2 点」)
2. **install stage は manifests を起点にする**。`manifests` は manifest
   だけ (`package.json` / `bun.lock` / workspace package の `package.json`) を COPY する薄い stage で、
   install layer の cache key を source の編集から切り離す。workspace package を増やす時にここへ
   COPY を 1 行足す必要があるのはこのためである (Docker の glob COPY は path を flatten するので 1 ディレクトリずつ
   明示する)。足し忘れは deps stage の `bun install --frozen-lockfile` が失敗するので気付けるが、
   メッセージは 2 通りに分かれる (bun 1.3.5 で実測)。root が `workspace:*` で依存する通常の
   workspace package では `error: Workspace dependency "<name>" not found` になる。bun.lock が正しいのに
   これで失敗したら manifests stage の COPY 漏れと読む (CLAUDE.md「リポジトリ共通規則」の workspace 依存の項と同じ文言)。
   root が依存していない workspace package の場合だけ
   `error: lockfile had changes, but lockfile is frozen` になる。
   `deps` は manifests から full install した**後に** source を COPY して auth-client を
   build する (handler が dist 経由で型解決するため build は必須である。COPY を install の前に置くと SDK の
   1 行編集で install layer が毎回無効化される)。deps stage は web build が devDependencies
   (vite / tailwind 等) を要するため full install のまま残す
3. **既定 target (最終 stage) は full-toolchain の dev stage** (`FROM web-build` + `COPY . .`) を
   維持する。taimei 側の e2e との cross-repo 契約である
4. **`.dockerignore` は `**/node_modules` / `**/dist`** に広げ、`COPY . .` が stage 内で build した
   成果物を host の古い成果物で上書きする経路を塞ぐ (パターンを root-anchor に狭めないこと)

## Consequences

- advisory 対応時の影響判定は「server コードが import しうる package か」で行う。web 専用の 13 件は biome の
  ban が import を止めるので、advisory は package.json の dependencies セクションと `ALLOWED_DEV_DEPENDENCIES`
  (`src/__tests__/dependency-classification.test.ts`) だけを見ればよい
- 位置契約 (既定 target が dev であること) の検証は機械化した。CI の `docker` job
  (既定 build と `--target dev` build の image ID が一致することの assert と、`scripts/docker-smoke.sh` の dev モード)
  と config-invariant テスト (`src/__tests__/dependency-classification.test.ts`
  の依存分類の同期と、`src/__tests__/dockerfile-contract.test.ts` の Dockerfile 静的 invariant。
  最後の `FROM ... AS <name>` が dev であること等) で検証する。
  ローカルで同じ assert を回すには、先に `scripts/docker-smoke.sh seed` で sentinel と canary を build context に
  作って image を build してから、`scripts/docker-smoke.sh dev <image>` を実行する (seed 無しだと不在の assert が何も検証しない)
- deploy.yml は CI workflow の **run-level conclusion** を gate にしているため、本番 deploy
  (migration を含む) が docker job の成否、ひいては base image の pull と GitHub Actions cache の可用性
  にも従属するようになった。CI が赤いとき deploy は failure ではなく **skipped** になり、通知が出ない。
  そのため「main に merge したのに本番へ出ていない」を検知する手段は CI failure の GitHub 標準通知である。
  緊急時の逃げ道は deploy.yml の `workflow_dispatch` (CI の conclusion に依存せず起動する)
- 上記の従属は「本番成果物が docker image になった」という意味ではない。image を使うのは
  ローカルの compose と taimei 側の e2e のみで、本番は `wrangler deploy` (workerd、ADR-0011) である。
  docker job は deploy の前提条件であって供給元ではない
- 当初案 (packages/ を deps から取る) は、2 つの install の bun store が混ざることと dangling symlink
  (auth-client の devDependency `typescript`) を生んだため棄却した (Decision 2 の形にした)
- 誤分類は biome の `noRestrictedImports` が CI の lint で検出する
- codegen (`db:generate` / `generate`) は host の bun で実行する運用に確定した。コンテナ内で実行すると
  生成物が `--rm` で消え、読む schema も image 焼き込み時点のものになるためである (実測)。「原則 compose で
  完結」(README「compose での環境操作」) に対する明示的な例外で、working tree へ書き出す作業のみが対象である
