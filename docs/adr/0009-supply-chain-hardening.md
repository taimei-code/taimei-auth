# ADR-0009: npm サプライチェーン攻撃に対する preventive hardening

## Context

2026-05-11、TeamPCP の **Mini Shai-Hulud worm** が `@tanstack/*` の router 系 42 パッケージに 84 悪性 version を publish し、worm は npm 169 / PyPI 2 パッケージへ自己増殖した。SLSA L3 attestation 付きの初の悪性 npm として記録され、攻撃ベクトルは `pull_request_target` の Pwn Request → GitHub Actions cache poisoning → runner memory からの OIDC token 抜き取り → 正規 release workflow からの publish という連鎖。

参照: [TanStack postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) / [StepSecurity 詳細](https://www.stepsecurity.io/blog/mini-shai-hulud-is-back-a-self-spreading-supply-chain-attack-hits-the-npm-ecosystem)

当リポの診断（2026-05-16 時点）:

- `@tanstack/*` は `better-auth` の optionalPeer に名前があるだけで node_modules に不在
- IoC (`~/Library/LaunchAgents/com.user.gh-token-monitor.plist`, `~/.config/systemd/user/gh-token-monitor.service`, `tanstack_runner.js` / `router_runtime.js` / `setup.mjs`) **すべて陰性**
- `pull_request_target` / `actions/cache` / public npm publish 経路 **いずれも未使用** (診断時点。その後 CI の docker job が buildx の `type=gha` (GitHub Actions cache backend) で image layer を cache するようになったため、cache 経路のみ現在は「未使用」ではない。詳細: ADR-0014)
  - この差分は **認識済み・受容** とする: gha cache の書き込みは同一 workflow run の `GITHUB_TOKEN` に閉じており、GitHub の cache isolation により PR (fork / branch を問わず) からの cache write は base branch の cache を汚染できない。あわせて docker job 自体の `permissions` を `contents: read` に絞った
- `publish-auth-client.yml` は GitHub Packages (org 内) 向けで public npm registry には publish しない

即時侵害リスクはないが、「悪性 version が publish されてから yank されるまでの数時間の窓」を将来の同種攻撃から塞ぐため、preventive な多重防御を導入する。直近事例 (axios 4h / Solana web3.js 5h / ua-parser-js 4h / 今回の TanStack も 6 分間隔で 2 wave) はいずれも 7 日以内に yank されており、cooldown ベースの対策が圧倒的にコスト効率が高い。

## Decision

### H. `minimumReleaseAge = 7d` で publish 直後の version を install しない

`bunfig.toml` を新規作成し、`[install]` セクションに `minimumReleaseAge = 604800` (= 7 日, 秒指定) を設定する。`minimumReleaseAgeExcludes` は空配列で開始し、CVE 緊急 patch などで「7 日待てない」場合のみ ADR 改訂 + PR で明示追加する運用 (bypass の audit trail を git 履歴に残す)。

Bun 1.3+ で対応済み (本リポは `bun-version: "1.3"`)。既に `bun.lock` にある version はそのまま install され続けるため、本設定は **`bun add` / `bun update` / Dependabot PR マージ後の再 resolve** タイミングで効く。

### A. GitHub Actions を commit SHA pin に変更

`actions/checkout` / `oven-sh/setup-bun` / `actions/setup-node` の version 指定を tag pin から **commit SHA pin + 末尾コメントの version 注釈** に変更する。tag は moving reference であり、再リンクされれば検知できずに悪性 version を実行する。

更新は `.github/dependabot.yml` の `package-ecosystem: "github-actions"` に委ね、Dependabot が SHA pin を維持したまま update PR を出す。`package-ecosystem: "npm"` も同時に有効化し、本リポ全体の依存更新を Dependabot に集約する。

機械検証: `src/__tests__/workflow-action-pin.test.ts` (全 workflow の `uses:` SHA pin を assert)

### B. CI に lockfile audit step を追加 + 既存 high fix

`.github/workflows/ci.yml` の install 直後に `bun audit --audit-level=high` を追加する。high/critical のみで fail し、`bun.lock` 全体に対する既知脆弱性 DB 照合を回す。

導入と同時に発見した既存 high 3 件を本 PR 内で fix:
- `drizzle-orm` は direct dep のため `package.json` の semver range を `^0.44.4 → ^0.45.2` に minor bump
- `defu` / `kysely` は `better-auth` / `drizzle-orm` の transitive のため `package.json` の `"overrides"` フィールドで強制固定 (`defu: ^6.1.7`, `kysely: ^0.28.17`)。`overrides` は npm 互換 syntax で bun もサポート

これら fix version はすべて 7 日以上前に publish されており `minimumReleaseAge` を bypass せずに resolve できた。

### C. Install lifecycle scripts を明示的に封じる

1. `package.json` に `"trustedDependencies": []` を明示追加 (空配列宣言で意図表明)
2. CI / Dockerfile の `bun install` に `--ignore-scripts` を明示追加

Bun の default は `trustedDependencies` 列挙パッケージのみ scripts を実行する仕様で、本リポは元々一つも信頼していないため動作差分は無い。**多重防御** として宣言と CLI flag を冗長に書く。将来 native binding 系依存 (e.g. `better-sqlite3`) を入れる際は、`trustedDependencies` への明示追加を PR で議論する。

## Why

### `minimumReleaseAge = 7d` を最優先で入れる理由

過去 1 年の主要なサプライチェーン事件は **悪性 version の生存時間が 4〜6 時間**: axios (2026-03), Solana web3.js (2024-12), Ledger Connect Kit (2023-12), ua-parser-js (2021-10)。いずれも 7 日以内に yank されている。`minimumReleaseAge = 7d` を入れるだけで、これら全クラスの攻撃を一網打尽に塞げる。コストは「install が npm registry API 制約で若干遅くなる」「CVE 緊急 patch で `minimumReleaseAgeExcludes` 手動追加が要る」のみで、効果対比で圧倒的に安い。

### SHA pin を入れる理由

今回の TanStack 攻撃の release workflow も `actions/*` を tag pin していた。tag の再リンクは別の攻撃ベクトル (例: GitHub Action 作者のアカウント乗っ取り) で発火するが、SHA pin であればその時点の content hash が違えば実行されない。Dependabot は SHA pin に対応しているため運用コストは weekly PR トリアージのみ。

### `bun audit` を入れる理由

`minimumReleaseAge` は「new attack vector」を防ぐが、**既知の CVE で yank されていないもの** には効かない。`bun audit` で既知 advisory との照合を CI gate に入れることで、別の層を作る。

### `trustedDependencies: []` + `--ignore-scripts` を入れる理由

install 時 RCE は今回の TanStack worm のメインベクトル (payload は postinstall で起動)。bun の default 安全動作に頼り切らず、`package.json` と CI 両方で declarative に「scripts は実行しない」を表明することで、bun の default 変更や `trustedDependencies` 誤追加に対する保険になる。

## Consequences

- `bun install` (新規 resolve 時) が npm registry API 制約で若干遅くなる
- CVE 緊急 patch 時は `bunfig.toml` の `minimumReleaseAgeExcludes` 手動追加が必要。Bun は Renovate と異なり security update でも bypass しない (bun issue #26065)
- Dependabot SHA update PR が weekly で発生 → トリアージコスト
- `--ignore-scripts` を明示しているため、将来 native binding 系依存 (例: `better-sqlite3`, `sharp`) 追加時は `trustedDependencies` への列挙判断が必要
- `bun audit` の false positive で CI が壊れる場合は `--audit-level=critical` への緩和か `continue-on-error: true` で warn 化する判断を要する
- **本 PR で audit step 導入と同時に既知 high 3 件を fix**: `drizzle-orm 0.44.4 → 0.45.2` (SQL injection via identifier escape; direct dep を minor bump), `defu → 6.1.7` (prototype pollution), `kysely → 0.28.17` (JSON-path traversal injection)。後者 2 件は better-auth/drizzle の transitive のため `package.json` の `overrides` で強制固定した。すべて `minimumReleaseAge = 7d` を満たす publish 日 (それぞれ 2026-03-27 / 2026-04-07 / 2026-05-03) のため bypass 不要

### `minimumReleaseAgeExcludes` 初回 bypass (2026-06-14, esbuild)

§H の「7 日待てない場合のみ ADR 改訂 + PR で明示追加」運用に基づく初の除外。

- 対象: `esbuild` (transitive; `drizzle-kit › esbuild` / `vite › tsx › esbuild`)。advisory `GHSA-gv7w-rqvm-qjhr` (HIGH, esbuild `<0.28.1`, Deno module の binary integrity 欠如により `NPM_CONFIG_REGISTRY` 経由で build 時 RCE)
- 経緯: 修正版 `0.28.1` が 2026-06-11 publish (= release 約 2 日) で 7 日齢に未達。`overrides` で `esbuild: 0.28.1` を固定しても `minimumReleaseAge` が install を block し、advisory は `bun audit --audit-level=high` の CI gate を落とす。よって `bunfig.toml` の `minimumReleaseAgeExcludes` に `esbuild` を追加し `overrides` 固定と併用して `0.28.1` に統一
- 実体 binary も除外対象: esbuild は platform 別 `@esbuild/<os>-<arch>` の optionalDependencies で binary を持ち、これらも同時 publish で block されると lockfile から落ち CI frozen install が「@esbuild/linux-x64 could not be found」で失敗する。glob (`@esbuild/*`) は本キーで効かないため 26 platform を明示列挙する。また bun は既存 lockfile に対しては fresh な optional binary を再解決しないため、main の lockfile を起点に `bun install` し直して esbuild 一族のみ差し替える (他 package の不要 refresh を避ける)
- リスク評価: esbuild は build 専用 devDep で本番 bundle に同梱されない。RCE は悪性 `NPM_CONFIG_REGISTRY` を要し攻撃面は限定的。`0.28.1` で auth-client build / vite build:web / drizzle-kit migrate / 全 test が green であることを確認済み
- 後始末 (任意): `0.28.1` と binary 群が 7 日齢 (2026-06-18 以降) を超えたら除外を外しても resolve は維持される

### `minimumReleaseAgeExcludes` 2 回目 bypass (2026-06-20, undici) + hono / vite fix

`bun audit` のライブ DB に新規 advisory 3 件 (hono / vite / undici) が出現し CI gate を落としたため対応。

- **hono** `GHSA-88fw-hqm2-52qc` (HIGH, `<4.12.25`, CORS Middleware が origin=wildcard 時に credentials 付きで任意 Origin を反映) → direct dep を `^4.12.25` に minor bump。`4.12.25` (2026-06-09) は 7 日齢を満たし bypass 不要
- **vite** `GHSA-fx2h-pf6j-xcff` (HIGH, `<=8.0.15`, Windows alternate path で `server.fs.deny` bypass) → build 専用 devDep を `^8.0.16` に。`8.0.16` (2026-06-01) は 7 日齢を満たし bypass 不要
- **undici** `GHSA-vxpw-j846-p89q` (HIGH, WebSocket client の fragment count DoS) → `@vercel/blob` の transitive。`overrides` で `6.27.0` に固定。`6.27.0` (2026-06-15) は release 5 日で 7 日齢未達のため `minimumReleaseAgeExcludes` に `undici` を追加 (esbuild と同じ「security patch < 7 日」bypass)
- リスク評価: undici advisory は WebSocket client のもので `@vercel/blob` は HTTP fetch 用途のため本アプリでは非該当。`6.27.0` で typecheck / lint / 全 test が green であることを確認済み
- 後始末 (任意): `6.27.0` が 7 日齢 (2026-06-22 以降) を超えたら `undici` 除外を外しても resolve は維持される

### audit gate 対応 3 回目 (2026-08-01, brace-expansion / postcss / react-router / sharp) + 初の `--ignore`

`bun audit` のライブ DB に新規 high advisory 4 家系が出現し CI gate を落としたため対応。全 fix version が 7 日齢を満たし `minimumReleaseAgeExcludes` 追加は不要。代わりに patch 版が存在しない advisory 1 件へ audit の `--ignore` を初導入した。

- **brace-expansion** `GHSA-mh99-v99m-4gvg` / `GHSA-3jxr-9vmj-r5cp` (HIGH, `>=4.0.0 <5.0.8`, 展開長無制限 / 連続 `{}` の指数時間展開による DoS) → `@sentry/bun › … › minimatch` の transitive。`bun update` は transitive を direct dep に昇格させてしまうため、`bun.lock` の該当 entry を registry の実 metadata (deps + integrity) で `5.0.8` に in-place 差し替え。`5.0.8` (2026-07-24) は 7 日齢を満たす
- **postcss** `GHSA-r28c-9q8g-f849` (HIGH, `<=8.5.17`, sourceMappingURL 経由の path traversal で任意 .map 読出) → direct devDep を `^8.5.23` に bump。lockfile に残る scoped entry (`tailwindcss/postcss` / `vite/postcss`) も同版へ in-place 統一。`8.5.23` (2026-07-25) は 7 日齢を満たす
- **sharp** `GHSA-f88m-g3jw-g9cj` (HIGH, `<0.35.0`, libvips 継承 CVE 群) → `wrangler › miniflare` の transitive で miniflare が `0.34.5` を exact pin するため `overrides` で `0.35.3` (2026-07-01) に固定。dev tool (miniflare) 専用で本番 bundle に同梱されない
- **react-router** `GHSA-chx6-hx7r-mcp5` (HIGH, route matching の非効率による DoS) → direct dep を `^7.18.1` に minor bump。`7.18.1` (2026-06-29) は 7 日齢を満たす
- **react-router** `GHSA-qwww-vcr4-c8h2` (HIGH, `>=7.12.0 <8.3.0`, RSC Mode の CSRF bypass) は **patched が `8.3.0` (major) のみで 7.x backport が無い**。本リポは declarative SPA router のみで RSC Mode / server action を使わず advisory 非該当のため、major 昇格はせず CI の audit step に `--ignore=GHSA-qwww-vcr4-c8h2` を付けて明示 accept する (bun audit 1.3+ の advisory 単位 ignore)。react-router を v8 に上げるか 7.x backport が出た時点でこの ignore を外すこと
- リスク評価: いずれも DoS / dev-tool / 非該当経路で本番実行面への影響は限定的。typecheck / lint / 全 test green を確認済み
- 教訓: lockfile の広範 entry 削除 + 非 clean `bun install` は better-auth 等の無関係 minor bump を誘発する (CLAUDE.md gotcha の再確認)。transitive の family 限定更新は「main lockfile 起点 + 対象 entry の in-place 差し替え + `bun install --frozen-lockfile` で検証」で行う

### audit gate 対応 4 回目 (2026-08-08, nanoid / brace-expansion) + 3 回目の `minimumReleaseAgeExcludes` bypass

`bun audit` のライブ DB に新規 high advisory 4 件 (nanoid 3 件 / brace-expansion 1 件) が出現し CI gate を落としたため対応。feature branch の diff とは無関係な依存側の変化。

- **nanoid** `GHSA-28wg-ghj8-5hjv` (HIGH, `<3.3.16` / `>=4.0.0 <5.1.16`, 非 secure generator が負の size で無限ループ) と `GHSA-2v37-7h3g-55p8` (HIGH, `<3.3.17` / `>=4.0.0 <5.1.6`, custom generator が size=0 で無限ループ) → direct dep の 5.x 系は `bun.lock` を `5.1.16` に in-place 差し替え (`package.json` の range `^5.1.11` は満たすため据え置き)。`5.1.16` (2026-06-24) は 7 日齢を満たす
- **nanoid 3.x (postcss transitive)** → 同じ手順で `3.3.17` に in-place 差し替え。`3.3.17` (2026-08-03) は release 5 日で 7 日齢に未達のため `bunfig.toml` の `minimumReleaseAgeExcludes` に `nanoid` を追加 (esbuild / undici と同じ「security patch < 7 日」bypass)。nanoid は pure JS で platform 別 optionalDependencies を持たないため、esbuild と違い 1 entry で足りる。あわせて postcss の宣言 (`nanoid: ^3.3.16`) を満たさないまま残っていた `3.3.12` の不整合も解消した
- **brace-expansion** `GHSA-rgw5-rvv9-x895` (HIGH, `>=4.0.0 <5.0.9`, 中間配列の無制限確保による DoS。3 回目対応で入れた `GHSA-mh99-v99m-4gvg` 緩和の bypass) → `@sentry/bun › … › minimatch` の transitive を `5.0.9` に in-place 差し替え。`5.0.9` (2026-07-30) は 7 日齢を満たし bypass 不要
- リスク評価: nanoid の 2 件はいずれも「不正な size 引数で generator が停止しない」性質で、呼び出し側が size を制御できる経路が前提。本リポの利用箇所は `db/repositories/` の 3 つ (`generateCompanyId` / `generateMembershipId` / `generateInvitationId` / `generateInvitationToken`) がすべて secure generator を literal size (24 / 32) で呼ぶのみで、user 入力が size に届く経路は無い。postcss 側も内部固定長利用のため非該当。brace-expansion も dev 依存の glob 経路の DoS で本番実行面には出ない
- 手順は 3 回目の教訓どおり: `bun update` を使わず (transitive を direct dep に昇格させるため) registry の実 metadata (version / integrity / dependencies) で `bun.lock` を in-place 差し替え → 非 clean `bun install` で当該 3 family のみが差し替わることを確認 → `bun install --frozen-lockfile` (CI parity) と typecheck / lint / 全 test の green を確認
- 後始末 (任意): `3.3.17` が 7 日齢 (2026-08-10 以降) を超えたら `nanoid` 除外を外しても resolve は維持される

### audit gate 対応 5 回目 (2026-08-14, nanoid advisory 範囲拡大)

`GHSA-2v37-7h3g-55p8` の 3.x 系 vulnerable range が 2026-08-13 に `<3.3.18` へ更新され、4 回目対応で固定した `3.3.17` が再び `bun audit --audit-level=high` gate を落とした。
この失敗は、機能ブランチの実装差分ではなく advisory DB 側の変更による。

- **nanoid 3.x (postcss transitive)** → `bun.lock` の `postcss/nanoid` entry だけを `3.3.18` に in-place 差し替え。`postcss@8.5.23` の宣言 (`nanoid: ^3.3.16`) を満たすため、postcss 自体の更新や複数 family への分岐は不要
- `3.3.18` は 2026-08-07 16:41 UTC publish で、失敗した CI (2026-08-14 11:49 UTC) 時点では 7 日齢に約 5 時間届かない
  4 回目で追加済みの `minimumReleaseAgeExcludes = ["nanoid", ...]` を継続し、緊急 security patch を解決可能にする
- direct dependency の nanoid 5.x は `5.1.16` で修正済みのため変更しない。リスク評価と利用経路は4回目対応から不変
- 後始末 (任意): `3.3.18` が 7 日齢を超える 2026-08-15 01:41 JST 以降は `nanoid` 除外を外しても resolve を維持できる

## Did not adopt

### D. publish-auth-client.yml の environment + required reviewers
`publish-auth-client.yml` は GitHub Packages (org 内) への publish で、public npm registry には出ない。tag trigger も org member 以外は実質叩けない。required reviewer 設定の運用コストが攻撃面の薄さに見合わないため見送り。将来 public npm publish が発生したら導入する。

### E. 開発者マシン用 IoC scan script
今回の Mini Shai-Hulud worm の IoC は陰性確認済み。worm version 毎に IoC は変わるため固定 script は腐敗しやすい。代わりに同等の手順を本 ADR 末尾に inline 記述する (下記)。

### F. `bun.lock` 差分の CODEOWNERS 必須レビュー化
H (`minimumReleaseAge`) で lockfile 経由侵害の主要窓を塞ぐため、bun.lock 専用 reviewer の上乗せ効果が薄い。

### G. base image `oven/bun:1.3` の digest pin
Actions は §A で SHA pin する一方、Dockerfile の base image は minor tag 止まり (patch は moving) という非対称がある。これを承知のうえで当面 pin しない。patch drift で repo 無変更のまま docker job が赤くなった場合は原因を都度切り分ける運用とし、頻発するようなら digest pin へ切り替える。

## Appendix: Mini Shai-Hulud worm IoC 手動検査手順

PR レビュー時や同種事件発生時に、開発者マシン上で以下を手動実行する:

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

DETECTED の場合は **token revoke の前に persistence daemon を削除** すること (revoke が wiper trigger になる挙動が報告されている)。詳細は [TanStack postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) を参照。
