# ADR-0009: npm サプライチェーン攻撃に対する preventive hardening

## Context

2026-05-11、TeamPCP の **Mini Shai-Hulud worm** が `@tanstack/*` の router 系 42 パッケージに 84 の悪性 version を publish し、worm は npm の 169 パッケージと PyPI の 2 パッケージへ自己増殖した。SLSA L3 attestation 付きの初の悪性 npm パッケージとして記録されている。攻撃は、`pull_request_target` の Pwn Request から GitHub Actions の cache poisoning、runner のメモリからの OIDC token の抜き取り、正規の release workflow からの publish という順に連鎖した。

参照: [TanStack postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) / [StepSecurity 詳細](https://www.stepsecurity.io/blog/mini-shai-hulud-is-back-a-self-spreading-supply-chain-attack-hits-the-npm-ecosystem)

このリポジトリの診断結果 (2026-05-16 時点) は次のとおりである。

- `@tanstack/*` は `better-auth` の optionalPeer に名前があるだけで、node_modules には存在しない
- IoC (`~/Library/LaunchAgents/com.user.gh-token-monitor.plist`、`~/.config/systemd/user/gh-token-monitor.service`、`tanstack_runner.js` / `router_runtime.js` / `setup.mjs`) は **すべて陰性**
- `pull_request_target` / `actions/cache` / public npm への publish 経路は **いずれも未使用** (診断時点)。その後、CI の docker job が buildx の `type=gha` (GitHub Actions cache backend) で image layer を cache するようになったため、cache 経路だけは現在「未使用」ではない (詳細: ADR-0014)
  - この差分は **認識したうえで受容** する。gha cache への書き込みは同一 workflow run の `GITHUB_TOKEN` に閉じており、GitHub の cache isolation により、PR (fork でも branch でも) からの cache write は base branch の cache を汚染できない。あわせて docker job 自体の `permissions` を `contents: read` に絞った
- `publish-auth-client.yml` は GitHub Packages (org 内) 向けであり、public な npm registry には publish しない

即時の侵害リスクはないが、「悪性 version が publish されてから yank されるまでの数時間の窓」を将来の同種攻撃から塞ぐため、予防的な多重防御を導入する。直近の事例 (axios 4 時間 / Solana web3.js 5 時間 / ua-parser-js 4 時間 / 今回の TanStack も 6 分間隔で 2 wave) はいずれも 7 日以内に yank されており、cooldown を基本にした対策が最もコスト効率が高い。

## Decision

### H. `minimumReleaseAge = 7d` で publish 直後の version を install しない

`bunfig.toml` を新規作成し、`[install]` セクションに `minimumReleaseAge = 604800` (秒指定で 7 日) を設定する。`minimumReleaseAgeExcludes` は空配列で始め、CVE の緊急 patch などで「7 日待てない」場合にだけ、ADR の改訂と PR で明示的に追加する運用にする (bypass の監査証跡を git 履歴に残すため)。

Bun 1.3 以降で対応している (このリポジトリは `bun-version: "1.3"`)。既に `bun.lock` にある version はそのまま install され続けるため、この設定は **`bun add` / `bun update` / Dependabot PR のマージ後の再 resolve** の時点で働く。

### A. GitHub Actions を commit SHA pin に変更

`actions/checkout` / `oven-sh/setup-bun` / `actions/setup-node` の version 指定を tag pin から **commit SHA pin と末尾コメントの version 注釈** に変更する。tag は動く参照であり、付け替えられれば検知できないまま悪性 version を実行してしまう。

更新は `.github/dependabot.yml` の `package-ecosystem: "github-actions"` に任せ、Dependabot が SHA pin を維持したまま update PR を出す。`package-ecosystem: "npm"` も同時に有効にし、このリポジトリ全体の依存更新を Dependabot に集約する。

機械検証: `src/__tests__/workflow-action-pin.test.ts` (全 workflow の `uses:` が SHA pin であることを assert する)

### B. CI に lockfile audit step を追加 + 既存 high fix

`.github/workflows/ci.yml` の install 直後に `bun audit --audit-level=high` を追加する。high と critical だけで fail させ、`bun.lock` 全体を既知脆弱性 DB と照合する。

導入と同時に発見した既存の high 3 件をこの PR 内で修正した。
- `drizzle-orm` は直接依存のため、`package.json` の semver range を `^0.44.4` から `^0.45.2` に minor bump した
- `defu` / `kysely` は `better-auth` / `drizzle-orm` の間接依存のため、`package.json` の `"overrides"` フィールドで強制的に固定した (`defu: ^6.1.7`、`kysely: ^0.28.17`)。`overrides` は npm 互換の構文で bun もサポートしている

これらの修正 version はすべて 7 日以上前に publish されており、`minimumReleaseAge` を bypass せずに resolve できた。

### C. Install lifecycle scripts を明示的に封じる

1. `package.json` に `"trustedDependencies": []` を明示的に追加する (空配列の宣言で意図を表明する)
2. CI と Dockerfile の `bun install` に `--ignore-scripts` を明示的に追加する

Bun の既定では `trustedDependencies` に列挙したパッケージだけが scripts を実行でき、このリポジトリはもともと一つも信頼していないため、動作の差は無い。**多重防御** として宣言と CLI flag を冗長に書く。将来 native binding 系の依存 (例: `better-sqlite3`) を入れる時は、`trustedDependencies` への明示的な追加を PR で議論する。

## Why

### `minimumReleaseAge = 7d` を最優先で入れる理由

過去 1 年の主要なサプライチェーン事件では、**悪性 version の生存時間が 4〜6 時間** だった: axios (2026-03)、Solana web3.js (2024-12)、Ledger Connect Kit (2023-12)、ua-parser-js (2021-10)。いずれも 7 日以内に yank されている。`minimumReleaseAge = 7d` を入れるだけで、この種類の攻撃をまとめて塞げる。コストは「install が npm registry API の制約で若干遅くなる」ことと「CVE の緊急 patch で `minimumReleaseAgeExcludes` の手動追加が要る」ことだけで、効果に比べて非常に安い。

### SHA pin を入れる理由

今回の TanStack 攻撃の release workflow も `actions/*` を tag pin していた。tag の付け替えは別の攻撃経路 (例: GitHub Action 作者のアカウント乗っ取り) で起きるが、SHA pin であれば、その時点の content hash が違えば実行されない。Dependabot は SHA pin に対応しているため、運用コストは weekly の PR トリアージだけである。

### `bun audit` を入れる理由

`minimumReleaseAge` は新しい攻撃経路は防ぐが、**既知の CVE で yank されていないもの** には対処できない。`bun audit` で既知 advisory との照合を CI の gate に入れ、別の層を作る。

### `trustedDependencies: []` + `--ignore-scripts` を入れる理由

install 時の RCE は今回の TanStack worm の主経路だった (payload は postinstall で起動する)。bun の既定の安全な動作に頼り切らず、`package.json` と CI の両方で「scripts は実行しない」と宣言的に表明しておけば、bun の既定が変わった場合や `trustedDependencies` を誤って追加した場合の保険になる。

## Consequences

- `bun install` (新規 resolve 時) が npm registry API の制約で若干遅くなる
- CVE の緊急 patch 時は `bunfig.toml` の `minimumReleaseAgeExcludes` への手動追加が必要である。Bun は Renovate と異なり、security update でも bypass しない (bun issue #26065)
- Dependabot の SHA update PR が weekly で発生するため、トリアージのコストがかかる
- `--ignore-scripts` を明示しているため、将来 native binding 系の依存 (例: `better-sqlite3`、`sharp`) を追加する時は `trustedDependencies` に列挙するかの判断が必要になる
- `bun audit` の false positive で CI が壊れる場合は、`--audit-level=critical` への緩和か `continue-on-error: true` での warn 化を判断する必要がある
- **この PR で audit step の導入と同時に既知の high 3 件を修正した**: `drizzle-orm 0.44.4 → 0.45.2` (identifier escape 経由の SQL injection。直接依存を minor bump)、`defu → 6.1.7` (prototype pollution)、`kysely → 0.28.17` (JSON-path traversal injection)。後者 2 件は better-auth / drizzle の間接依存のため、`package.json` の `overrides` で強制的に固定した。すべて publish 日 (それぞれ 2026-03-27 / 2026-04-07 / 2026-05-03) が `minimumReleaseAge = 7d` を満たすため、bypass は不要だった

### `minimumReleaseAgeExcludes` 初回 bypass (2026-06-14, esbuild)

§H の「7 日待てない場合にだけ ADR の改訂と PR で明示的に追加する」運用に基づく初の除外である。

- 対象: `esbuild` (間接依存。`drizzle-kit › esbuild` / `vite › tsx › esbuild`)。advisory は `GHSA-gv7w-rqvm-qjhr` (HIGH、esbuild `<0.28.1`。Deno module の binary integrity が欠けており、`NPM_CONFIG_REGISTRY` 経由で build 時に RCE)
- 経緯: 修正版 `0.28.1` は 2026-06-11 の publish (release から約 2 日) で、7 日齢に達していなかった。`overrides` で `esbuild: 0.28.1` を固定しても `minimumReleaseAge` が install を block し、advisory が `bun audit --audit-level=high` の CI gate を落とす。そこで `bunfig.toml` の `minimumReleaseAgeExcludes` に `esbuild` を追加し、`overrides` の固定と併用して `0.28.1` に統一した
- 実体の binary も除外対象である: esbuild は platform 別の `@esbuild/<os>-<arch>` を optionalDependencies として持ち、これらが同時 publish で block されると lockfile から落ち、CI の frozen install が「@esbuild/linux-x64 could not be found」で失敗する。glob (`@esbuild/*`) はこのキーでは使えないため、26 platform を明示的に列挙する。また bun は既存の lockfile に対して新しい optional binary を再解決しないため、main の lockfile を起点に `bun install` をやり直し、esbuild 一族だけを差し替える (他 package の不要な更新を避けるため)
- リスク評価: esbuild は build 専用の devDep で、本番 bundle には同梱されない。RCE には悪性の `NPM_CONFIG_REGISTRY` が必要で、攻撃面は限定的である。`0.28.1` で auth-client build / vite build:web / drizzle-kit migrate / 全テストが通ることを確認済み
- 後始末 (任意): `0.28.1` と binary 群が 7 日齢 (2026-06-18 以降) を超えたら、除外を外しても resolve は維持される

### `minimumReleaseAgeExcludes` 2 回目 bypass (2026-06-20, undici) + hono / vite fix

`bun audit` のライブ DB に新規 advisory 3 件 (hono / vite / undici) が出現し、CI gate を落としたため対応した。

- **hono** `GHSA-88fw-hqm2-52qc` (HIGH、`<4.12.25`。CORS Middleware が origin=wildcard の時に credentials 付きで任意の Origin を反映する) は、直接依存を `^4.12.25` に minor bump した。`4.12.25` (2026-06-09) は 7 日齢を満たし、bypass は不要
- **vite** `GHSA-fx2h-pf6j-xcff` (HIGH、`<=8.0.15`。Windows の alternate path で `server.fs.deny` を bypass できる) は、build 専用の devDep を `^8.0.16` にした。`8.0.16` (2026-06-01) は 7 日齢を満たし、bypass は不要
- **undici** `GHSA-vxpw-j846-p89q` (HIGH。WebSocket client の fragment count による DoS) は `@vercel/blob` の間接依存で、`overrides` で `6.27.0` に固定した。`6.27.0` (2026-06-15) は release から 5 日で 7 日齢に達していないため、`minimumReleaseAgeExcludes` に `undici` を追加した (esbuild と同じ「security patch が 7 日未満」の bypass)
- リスク評価: undici の advisory は WebSocket client のもので、`@vercel/blob` は HTTP fetch の用途のため、このアプリには該当しない。`6.27.0` で typecheck / lint / 全テストが通ることを確認済み
- 後始末 (任意): `6.27.0` が 7 日齢 (2026-06-22 以降) を超えたら、`undici` の除外を外しても resolve は維持される

### audit gate 対応 3 回目 (2026-08-01, brace-expansion / postcss / react-router / sharp) + 初の `--ignore`

`bun audit` のライブ DB に新規の high advisory が 4 家系出現し、CI gate を落としたため対応した。修正 version はすべて 7 日齢を満たし、`minimumReleaseAgeExcludes` への追加は不要だった。代わりに、patch 版が存在しない advisory 1 件に対して audit の `--ignore` を初めて導入した。

- **brace-expansion** `GHSA-mh99-v99m-4gvg` / `GHSA-3jxr-9vmj-r5cp` (HIGH、`>=4.0.0 <5.0.8`。展開長が無制限であることと、連続する `{}` の指数時間展開による DoS) は `@sentry/bun › … › minimatch` の間接依存である。`bun update` は間接依存を直接依存に昇格させてしまうため、`bun.lock` の該当 entry を registry の実際の metadata (deps と integrity) で `5.0.8` に in-place で差し替えた。`5.0.8` (2026-07-24) は 7 日齢を満たす
- **postcss** `GHSA-r28c-9q8g-f849` (HIGH、`<=8.5.17`。sourceMappingURL 経由の path traversal で任意の .map を読み出せる) は、直接の devDep を `^8.5.23` に bump した。lockfile に残る scoped entry (`tailwindcss/postcss` / `vite/postcss`) も同じ版に in-place で統一した。`8.5.23` (2026-07-25) は 7 日齢を満たす
- **sharp** `GHSA-f88m-g3jw-g9cj` (HIGH、`<0.35.0`。libvips から継承した CVE 群) は `wrangler › miniflare` の間接依存で、miniflare が `0.34.5` を exact pin しているため `overrides` で `0.35.3` (2026-07-01) に固定した。dev tool (miniflare) 専用で、本番 bundle には同梱されない
- **react-router** `GHSA-chx6-hx7r-mcp5` (HIGH。route matching の非効率による DoS) は、直接依存を `^7.18.1` に minor bump した。`7.18.1` (2026-06-29) は 7 日齢を満たす
- **react-router** `GHSA-qwww-vcr4-c8h2` (HIGH、`>=7.12.0 <8.3.0`。RSC Mode の CSRF bypass) は、**patched が `8.3.0` (major) だけで 7.x への backport が無い**。このリポジトリは declarative な SPA router だけを使い、RSC Mode や server action を使わないため advisory に該当しない。そのため major 昇格はせず、CI の audit step に `--ignore=GHSA-qwww-vcr4-c8h2` を付けて明示的に accept する (bun audit 1.3 以降の advisory 単位の ignore)。react-router を v8 に上げるか 7.x への backport が出た時点で、この ignore を外すこと
- リスク評価: いずれも DoS、dev tool 専用、または該当しない経路で、本番の実行面への影響は限定的である。typecheck / lint / 全テストが通ることを確認済み
- 教訓: lockfile の広範な entry 削除と、clean でない `bun install` の組み合わせは、better-auth などの無関係な minor bump を誘発する (CLAUDE.md の gotcha の再確認)。間接依存の family を限定した更新は、「main の lockfile を起点に、対象 entry を in-place で差し替え、`bun install --frozen-lockfile` で検証する」手順で行う

### audit gate 対応 4 回目 (2026-08-08, nanoid / brace-expansion) + 3 回目の `minimumReleaseAgeExcludes` bypass

`bun audit` のライブ DB に新規の high advisory 4 件 (nanoid 3 件 / brace-expansion 1 件) が出現し、CI gate を落としたため対応した。feature branch の差分とは無関係な、依存側の変化である。

- **nanoid** `GHSA-28wg-ghj8-5hjv` (HIGH、`<3.3.16` / `>=4.0.0 <5.1.16`。secure でない generator が負の size で無限ループする) と `GHSA-2v37-7h3g-55p8` (HIGH、`<3.3.17` / `>=4.0.0 <5.1.6`。custom generator が size=0 で無限ループする) について、直接依存の 5.x 系は `bun.lock` を `5.1.16` に in-place で差し替えた (`package.json` の range `^5.1.11` は満たすため据え置き)。`5.1.16` (2026-06-24) は 7 日齢を満たす
- **nanoid 3.x (postcss の間接依存)** は同じ手順で `3.3.17` に in-place で差し替えた。`3.3.17` (2026-08-03) は release から 5 日で 7 日齢に達していないため、`bunfig.toml` の `minimumReleaseAgeExcludes` に `nanoid` を追加した (esbuild / undici と同じ「security patch が 7 日未満」の bypass)。nanoid は pure JS で platform 別の optionalDependencies を持たないため、esbuild と違い 1 entry で足りる。あわせて、postcss の宣言 (`nanoid: ^3.3.16`) を満たさないまま残っていた `3.3.12` の不整合も解消した
- **brace-expansion** `GHSA-rgw5-rvv9-x895` (HIGH、`>=4.0.0 <5.0.9`。中間配列の無制限な確保による DoS。3 回目対応で入れた `GHSA-mh99-v99m-4gvg` の緩和を bypass するもの) は、`@sentry/bun › … › minimatch` の間接依存を `5.0.9` に in-place で差し替えた。`5.0.9` (2026-07-30) は 7 日齢を満たし、bypass は不要
- リスク評価: nanoid の 2 件はいずれも「不正な size 引数で generator が停止しない」性質のもので、呼び出し側が size を制御できる経路が前提になる。このリポジトリの利用箇所は `db/repositories/` の 3 ファイル (`generateCompanyId` / `generateMembershipId` / `generateInvitationId` / `generateInvitationToken`) で、すべて secure generator をリテラルの size (24 / 32) で呼ぶだけであり、user 入力が size に届く経路は無い。postcss 側も内部で固定長を使うだけで該当しない。brace-expansion も dev 依存の glob 経路の DoS で、本番の実行面には出ない
- 手順は 3 回目の教訓どおり: `bun update` は使わず (間接依存を直接依存に昇格させるため)、registry の実際の metadata (version / integrity / dependencies) で `bun.lock` を in-place で差し替え、clean でない `bun install` でその 3 family だけが差し替わることを確認し、`bun install --frozen-lockfile` (CI と同条件) と typecheck / lint / 全テストが通ることを確認した
- 後始末 (任意): `3.3.17` が 7 日齢 (2026-08-10 以降) を超えたら、`nanoid` の除外を外しても resolve は維持される

### audit gate 対応 5 回目 (2026-08-14, nanoid advisory 範囲拡大)

`GHSA-2v37-7h3g-55p8` の 3.x 系の vulnerable range が 2026-08-13 に `<3.3.18` へ更新され、4 回目対応で固定した `3.3.17` が再び `bun audit --audit-level=high` の gate を落とした。
この失敗は機能ブランチの実装差分ではなく、advisory DB 側の変更による。

- **nanoid 3.x (postcss の間接依存)** は、`bun.lock` の `postcss/nanoid` entry だけを `3.3.18` に in-place で差し替えた。`postcss@8.5.23` の宣言 (`nanoid: ^3.3.16`) を満たすため、postcss 自体の更新や複数 family への分岐は不要である
- `3.3.18` は 2026-08-07 16:41 UTC の publish で、失敗した CI (2026-08-14 11:49 UTC) の時点では 7 日齢に約 5 時間足りない。
  4 回目で追加済みの `minimumReleaseAgeExcludes = ["nanoid", ...]` を継続し、緊急の security patch を解決できるようにする
- 直接依存の nanoid 5.x は `5.1.16` で修正済みのため変更しない。リスク評価と利用経路は 4 回目対応から変わらない
- 後始末 (任意): `3.3.18` が 7 日齢を超える 2026-08-15 01:41 JST 以降は、`nanoid` の除外を外しても resolve を維持できる

### audit gate 対応 6 回目 (2026-09-03, browserslist)

`bun audit` のライブ DB に browserslist の新規 high advisory 2 件が出現し、CI gate を落としたため対応した。feature branch (Redis keep-alive の Cron Trigger) の実装差分とは無関係な、依存側の変化である。

- **browserslist** `GHSA-c83g-rgw3-j3cx` (HIGH、`<=4.28.6`。query 結果の cache に eviction が無く、distinct な query の蓄積で OOM になる) / `GHSA-73wf-gq98-2v4g` (HIGH、`<=4.28.6`。信頼できない `browserslist-stats.json` の custom stats 経由で crash または prototype への書き込みが起きる) は、`autoprefixer › browserslist` の間接依存を `bun.lock` で `4.28.8` (2026-08-08) に in-place で差し替えた。7 日齢を満たすため、`minimumReleaseAgeExcludes` への追加は不要
- `4.28.8` は依存の range を引き上げているため、同じ family の 5 entry も range を満たす 7 日齢以上の版へ in-place で差し替えた: `baseline-browser-mapping` `2.11.19` (2026-08-24) / `caniuse-lite` `1.0.30001810` (2026-08-24) / `electron-to-chromium` `1.5.415` (2026-08-25) / `node-releases` `2.0.53` (2026-08-06) / `update-browserslist-db` `1.3.1` (2026-08-10)。`escalade` / `picocolors` は既存の版が range を満たすため据え置き
- リスク評価: browserslist は Tailwind / autoprefixer の build 時 (Vite build) にだけ使われ、本番の Worker bundle には同梱されない。query はこのリポジトリの固定設定だけで、user 入力や外部の stats ファイルは届かない
- 手順は 3〜5 回目と同じ: `bun update` は使わず registry の実際の metadata で `bun.lock` を差し替え、clean でない `bun install` でその 6 entry だけが差し替わることを確認し、`bun install --frozen-lockfile` (CI と同条件) / `bun audit` / `build:web` / typecheck / lint / 全テストが通ることを確認した

### audit gate 対応 7 回目 (2026-09-09, sharp)

`bun audit` のライブ DB に sharp の新規 high advisory が出現し、CI gate を落としたため対応した。feature branch (コメント予算の gate) の実装差分とは無関係な、依存側の変化である。

- **sharp** `GHSA-rgj7-g3m4-5g8c` (HIGH、`<0.35.4`。libheif から継承した CVE 群 `GHSA-g89c-p67h-r497` / `GHSA-2jg2-4ch7-h545`) は、3 回目対応で `overrides` に置いた `0.35.3` を `0.35.4` (2026-08-26) へ上げ、clean でない `bun install` で sharp family (`sharp` と `@img/sharp-*` が 0.35.4、`@img/sharp-libvips-*` が 1.3.3。いずれも 2026-08-26) だけが差し替わることを確認した。7 日齢を満たすため、`minimumReleaseAgeExcludes` への追加は不要
- リスク評価と利用経路は 3 回目対応から変わらない (`wrangler › miniflare` の dev tool 専用で、本番 bundle には同梱されない)
- override 経由のため in-place の差し替えは不要で、`package.json` の 1 行変更と `bun install` で済む。`bun install --frozen-lockfile` (CI と同条件) / `bun audit` / typecheck / lint / 全テストが通ることを確認した

## Did not adopt

### D. publish-auth-client.yml の environment + required reviewers
`publish-auth-client.yml` は GitHub Packages (org 内) への publish で、public な npm registry には出ない。tag trigger も org member 以外は実質的に実行できない。required reviewer 設定の運用コストが攻撃面の薄さに見合わないため見送った。将来 public な npm への publish が発生したら導入する。

### E. 開発者マシン用 IoC scan script
今回の Mini Shai-Hulud worm の IoC は陰性を確認済みである。IoC は worm の version ごとに変わるため、固定した script は古くなりやすい。代わりに同等の手順をこの ADR の末尾に inline で記述する (下記)。

### F. `bun.lock` 差分の CODEOWNERS 必須レビュー化
H (`minimumReleaseAge`) で lockfile 経由の侵害の主な窓を塞ぐため、bun.lock 専用の reviewer を上乗せしても効果が薄い。

### G. base image `oven/bun:1.3` の digest pin
Actions は §A で SHA pin する一方、Dockerfile の base image は minor tag 止まり (patch は動く) という非対称がある。これを承知のうえで当面は pin しない。patch のずれによってリポジトリに変更が無いまま docker job が赤くなった場合は原因を都度切り分ける運用とし、頻発するようなら digest pin へ切り替える。

## Appendix: Mini Shai-Hulud worm IoC 手動検査手順

PR レビュー時や同種の事件が発生した時に、開発者マシン上で以下を手動で実行する。

```bash
# 1. macOS persistence daemon
test -f ~/Library/LaunchAgents/com.user.gh-token-monitor.plist && echo "DETECTED" || echo "clean"

# 2. Linux persistence daemon
test -f ~/.config/systemd/user/gh-token-monitor.service && echo "DETECTED" || echo "clean"

# 3. リポジトリ内の既知ペイロード
find . -name "tanstack_runner.js" -o -name "router_runtime.js" -o -name "setup.mjs"

# 4. lockfile 内の compromised パッケージ family
grep -E "@tanstack/(router|start|devtools|adapter)" bun.lock
```

DETECTED の場合は **token を revoke する前に persistence daemon を削除** すること (revoke が wiper の trigger になる挙動が報告されている)。詳細は [TanStack postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) を参照。
