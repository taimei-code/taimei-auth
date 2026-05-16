# ADR-0009: npm サプライチェーン攻撃に対する preventive hardening

## Context

2026-05-11、TeamPCP の **Mini Shai-Hulud worm** が `@tanstack/*` の router 系 42 パッケージに 84 悪性 version を publish し、worm は npm 169 / PyPI 2 パッケージへ自己増殖した。SLSA L3 attestation 付きの初の悪性 npm として記録され、攻撃ベクトルは `pull_request_target` の Pwn Request → GitHub Actions cache poisoning → runner memory からの OIDC token 抜き取り → 正規 release workflow からの publish という連鎖。

参照: [TanStack postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) / [StepSecurity 詳細](https://www.stepsecurity.io/blog/mini-shai-hulud-is-back-a-self-spreading-supply-chain-attack-hits-the-npm-ecosystem)

当リポの診断（2026-05-16 時点）:

- `@tanstack/*` は `better-auth` の optionalPeer に名前があるだけで node_modules に不在
- IoC (`~/Library/LaunchAgents/com.user.gh-token-monitor.plist`, `~/.config/systemd/user/gh-token-monitor.service`, `tanstack_runner.js` / `router_runtime.js` / `setup.mjs`) **すべて陰性**
- `pull_request_target` / `actions/cache` / public npm publish 経路 **いずれも未使用**
- `publish-auth-client.yml` は GitHub Packages (org 内) 向けで public npm registry には publish しない

即時侵害リスクはないが、「悪性 version が publish されてから yank されるまでの数時間の窓」を将来の同種攻撃から塞ぐため、preventive な多重防御を導入する。直近事例 (axios 4h / Solana web3.js 5h / ua-parser-js 4h / 今回の TanStack も 6 分間隔で 2 wave) はいずれも 7 日以内に yank されており、cooldown ベースの対策が圧倒的にコスト効率が高い。

## Decision

### H. `minimumReleaseAge = 7d` で publish 直後の version を install しない

`bunfig.toml` を新規作成し、`[install]` セクションに `minimumReleaseAge = 604800` (= 7 日, 秒指定) を設定する。`minimumReleaseAgeExcludes` は空配列で開始し、CVE 緊急 patch などで「7 日待てない」場合のみ ADR 改訂 + PR で明示追加する運用 (bypass の audit trail を git 履歴に残す)。

Bun 1.3+ で対応済み (本リポは `bun-version: "1.3"`)。既に `bun.lock` にある version はそのまま install され続けるため、本設定は **`bun add` / `bun update` / Dependabot PR マージ後の再 resolve** タイミングで効く。

### A. GitHub Actions を commit SHA pin に変更

`actions/checkout` / `oven-sh/setup-bun` / `actions/setup-node` の version 指定を tag pin から **commit SHA pin + 末尾コメントの version 注釈** に変更する。tag は moving reference であり、再リンクされれば検知できずに悪性 version を実行する。

更新は `.github/dependabot.yml` の `package-ecosystem: "github-actions"` に委ね、Dependabot が SHA pin を維持したまま update PR を出す。`package-ecosystem: "npm"` も同時に有効化し、本リポ全体の依存更新を Dependabot に集約する。

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

## Did not adopt

### D. publish-auth-client.yml の environment + required reviewers
`publish-auth-client.yml` は GitHub Packages (org 内) への publish で、public npm registry には出ない。tag trigger も org member 以外は実質叩けない。required reviewer 設定の運用コストが攻撃面の薄さに見合わないため見送り。将来 public npm publish が発生したら導入する。

### E. 開発者マシン用 IoC scan script
今回の Mini Shai-Hulud worm の IoC は陰性確認済み。worm version 毎に IoC は変わるため固定 script は腐敗しやすい。代わりに同等の手順を本 ADR 末尾に inline 記述する (下記)。

### F. `bun.lock` 差分の CODEOWNERS 必須レビュー化
H (`minimumReleaseAge`) で lockfile 経由侵害の主要窓を塞ぐため、bun.lock 専用 reviewer の上乗せ効果が薄い。

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
