# ADR-0021: 本番の code は自分が本番かどうかを知らず、本番は本番以外の code が無い tree から build する

## Status

Accepted (2026-10-24)。判断主体は maintainer。実装は taimei-code/taimei-auth#330。この ADR は ADR-0020 の Decision 5 の「型の境界」を、除外した tree からの build に置き換える (ADR-0020 に追記した)。

関連: ADR-0003 (redirect 先の allowlist)、ADR-0004 (cookie)、ADR-0011 (Workers 移行)、ADR-0020 (試験の環境)、GLOSSARY.md の **本番以外**。

## Context

**本番以外** のためだけの機能 (試験 API、アカウント選択画面、開発者ホーム、送ったメールの記録) の多くは、資格情報なしに任意の利用者になれる能力である。本番で動けば、そのままアカウントの乗っ取りになる。

これまでは `isLocalEnvironment()` (`APP_ENV !== "production"`) が本番の code の中で、手元向けに緩めた設定を選んでいた。緩めの書き方が公認されているので誰でも分岐を足せ、`APP_ENV` が無い時や綴りを誤った時は緩めた設定で動いた。本番の bundle の検査は既知の path と file 名を探すだけで、知らない名前は見つけられなかった。主な脅威は、人か LLM の開発者が過失で本番以外の code や能力を本番に持ち込むことである。

## Decision

1. **`src/` は `APP_ENV` で振る舞いを変えない**。`APP_ENV` を読むのは `src/worker.ts` が Sentry の環境名を決める所だけである。環境の差は次の 3 つで表す
   - 安全の設定 (session の cookie の `Secure`、試行回数の上限、service key の必須、proxy の段数の必須) は本番の値の定数にし、本番以外も同じ値で動く。本番以外は値を渡す
   - 安全に関わらない設定は環境変数の値で渡す
   - 違う振る舞い (送ったメールの記録など) は、本番以外の入口が別の実装を渡す
   - (2026-10-26 追記) 依存先が読む環境変数と runtime の判定にも同じ規則を当てる。better-auth は `NODE_ENV=production` の時だけ rateLimit を既定で有効にするので、`src/auth.ts` が無効を明示する (`src/__tests__/better-auth-assumptions.test.ts`)。client の IP は入口 (`src/worker.ts` と `testing/bun-server.ts`) が決めて header に置き、`src/` は runtime を判定しない
2. **redirect 先の allowlist だけは、本番の定数の module を本番以外の build と実行が差し替える**。本番の code は `src/redirect-hosts.ts` (`https:` と本番の host) を `@core/redirect-hosts` で import するだけで、差し替えの口を持たない。本番以外は `testing/redirect-hosts.ts` に替える (許す protocol と host は [ADR-0003](./0003-redirect-url-allowlist-policy.md) の Decision)。worker は `testing/wrangler.jsonc` の `alias`、web は `web/non-production/vite.config.ts` の `resolve.alias`、Bun の server と `bun test` は `testing/redirect-hosts-plugin.ts` の `onLoad` (preload) で替える。付け忘れると本番の定数で動き (安全な側)、本番以外の入口は起動の時にそれを見つけて止まる。(2026-10-31 追記) **staging** も本番以外の build として、`testing/wrangler.jsonc` の `alias` でこの module に替える。module には staging の host を完全一致で足す (ADR-0022 の Decision 7・8)
3. **本番の worker と web は `testing/`・`web/non-production/`・`db/testing/` を外した tree から build する**。`scripts/build-production-tree.sh` が `HEAD` を `git archive` で展開し (root を起点にした pathspec で外す)、その中で build と既知の文字列の検査を行う。PR の CI、`deploy.yml`、`deploy-durable-object-migration.yml` が同じ script を呼ぶ。本番の code が除外した dir を import すると build が止まり、`// @ts-ignore` を付けても止まる
4. **本番以外の worker は `testing/wrangler.jsonc` で動く**。本番の name・route・Hyperdrive の id・vars を持たないので、誤って deploy しても本番に載らない
5. **DO の migration は CI の手動の workflow (`deploy-durable-object-migration.yml`) から出す**。人が本番の deploy の token を手元に持つ理由を無くすためである。`wrangler deploy` は smoke gate を通らずに全体へすぐ反映し、適用した後は適用前の version へ戻せない (Cloudflare の API が code 10210 で拒む)。これは受け入れる

## Considered Options

- **型の境界** (本番の tsconfig の `include` から本番以外の dir を外し、import を TS6307 で止める): `// @ts-ignore` の 1 行で消え、`tsc --noEmit` は build でもないので、人の過失への対策に数えない
- **検出して弾く** (既知の文字列の検査を広げる): 知らない名前を見つけられない。補助の検査として残す
- **allowlist を入口から Layer や引数で渡す**: 本番の code に手元の値を受け取る口が残り、本番の code の中で手元の値を渡す分岐を書ける。web の本番の画面の入口は本番以外の build と同じなので、web はどのみち build での差し替えが要る
- **本番の allowlist に `*.taimei-code.localhost` を含める**: `*.localhost` は loopback に固定され外の攻撃者は受け取れないが、本番に本番以外の値を残す前例になる

## Consequences

- 本番以外の Bun の server は `--preload=./testing/redirect-hosts-plugin.ts` を付けて起動する (試験の環境の compose の断片が付ける)
- 開発環境の host は `*.taimei-code.localhost` で、http でも `Secure` の cookie が使える。browser が container の中で動く時は `--host-resolver-rules` が要る
- e2e のログイン用の試験 API (`POST /testing/v1/login-links`、既存の利用者の email でログインの URL を返す) は、taimei-auth 自身の e2e の起動 script (`e2e/start-server.sh`) が build の定数 `TAIMEI_AUTH_E2E_LOGIN_LINKS` を渡した時だけ、本番以外の worker が載せる。開発環境と試験の環境には載らない。資格情報なしに既存の利用者になれる能力なので、ADR-0020 の Decision 7 (候補をその browser でログインした利用者に絞る) を開発環境と試験の環境で保つためである。定数を渡すのが e2e の起動 script だけであることは `testing/__tests__/e2e-login-links-entry.test.ts` が確かめる
- build の失敗の文言は、「code を `src/` に移す」「一覧を縮める」直し方をしないよう固定してある
- 手で書いた `hostname === "localhost"` のような分岐は構造では止められない。公認の書き方と、緩めたい理由が無いことで、書かれた時にレビューで目立つようにする
