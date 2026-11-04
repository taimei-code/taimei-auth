# 本番の取り込みと、IaC の外に残る手作業

本番の資源は `infra/alchemy.run.ts` の stage `production` で宣言する。判断の理由は [ADR-0022](../adr/0022-staging-by-alchemy.md) の「#309 で足したこと」にある。

## 前提

- 本番のアカウント (`taimei-production`) の token の権限: Workers Scripts Edit、Secrets Store Edit、Workers Routes Edit (custom domain)、Zone Read、Hyperdrive Read、Account Settings Read。Environment `production` の `CLOUDFLARE_API_TOKEN` もこの権限にする
- 手元で本番の token を使うのは「1 回だけの手順」の間だけにする。短い期限の token を作り、終わったら消す。手元の `ALCHEMY_HOME` は一時 dir にし、終わったら消す (state の置き場の token が cache される)

## 1 回だけの手順

taimei の本番は Worker の名前 `taimei-auth`、`AUTH_SERVICE_KEY` の値、custom domain に依存している。どれも変えない。取り込みから merge まで、main に他の PR を merge しない (main の deploy はまだ wrangler の経路で、Secrets Store の binding を落とす)。

1. 予行演習: 本番のアカウントに、wrangler で使い捨ての Worker (custom domain・SQLite の DO・`secret_text`・vars つき) を作り、repo の外に写した定義で ADR-0022 の R1〜R7 を確かめる。終わったら Worker・custom domain・Secrets Store の secret を消す。どれかが通らなければ止める
2. 棚卸し: 本番の 8 つの secret の値を持っているか確かめる。`AUTH_SECRET` と `MFA_TOTP_ENCRYPTION_KEYS` は今の本番と同じ値でなければならない (`AUTH_SECRET` が違うと全員がログアウトし、`MFA_TOTP_ENCRYPTION_KEYS` が違うと MFA の利用者がログインできなくなる)。この 2 つと `AUTH_SERVICE_KEY` の値が無ければ、下の「今の値の無い secret を作り直す」で作り直すか、止める (`service-key-rotation.md` は今の値を `AUTH_SERVICE_KEY_PREVIOUS` に入れるので、値が無いと使えない)。`AUTH_RESEND_KEY`・`AUTH_GITHUB_SECRET`・`BLOB_READ_WRITE_TOKEN` は発行し直してよい。`AUTH_GITHUB_ID` と `SENTRY_DSN` は各サービスの画面で読める
3. 本番の Secrets Store (無ければ作る) に 8 つの secret を、`src/secret-bindings.ts` の名前で入れる
4. 本番の tree を作る: `bash scripts/build-production-tree.sh <空の dir>`。tree は HEAD から作るので、先に PR の branch の変更を commit する。以下は tree の中で行う
5. `bun infra/check-worker.ts production adopt` が通ることを確かめる。差があれば `infra/stages.ts` を直してから進む (定義に無い binding は取り込みで消える)
   - workers.dev が有効と出たら、dashboard で無効にしてから進む。表で本番の配信先は custom domain (`servedAt` の `customDomain`) だけで、workers.dev を持たない。taimei は service binding と custom domain で auth を呼ぶので、workers.dev の URL に依存するものは無い
   - observability の差が出たら、`infra/stages.ts` の `WORKER_RUNTIME.observability` を本番の今の値に直す。この値は staging にも当たり、staging の次の 100% の deploy で staging の設定も変わる
6. 取り込み: `DEPLOY_MODE=adopt bunx alchemy deploy infra/alchemy.run.ts --stage production --adopt`。plan に binding の削除 (`unbind`・`delete`) が無いことを見てから承認する。途中で止まったら、同じ command を流し直す (state には取り込んだと記録されるので、2 回目の plan は `adopted` ではなく `update` と出る)。後で `bun infra/check-worker.ts production adopt` と、今の 100% の version への smoke を流す
7. secret の切り替え: 下の「0% の version を手で確かめる」で Secrets Store の binding を持つ version を 0% に加え、override header を付けたブラウザで、今のログインが続くこと、MFA の利用者がログインできること (QA-MR-06) を確かめる。通れば `<new>@100%`、だめなら `bunx wrangler rollback <current> --name taimei-auth --yes` で戻して止める。`versions deploy <current>@100%` は、secret が変わったとして拒まれる (code 10220)。rollback は同じ確認を出して進め、前の version は自分の `secret_text` で動き続ける
8. `bun infra/check-worker.ts production gate` が通る → PR を merge → Deploy の staging と本番の job が通る → `IaC drift` を手動で起動して差が無い
9. merge の後、`adopt` を消す PR を出す。取り込みの後に `adopt` の deploy を流すと、Secrets Store の binding の無い version が 100% になり、本番が secret を読めなくなるためである。消すのは `infra/stages.ts` の `DEPLOY_MODES` と `expectedBindings` の `mode`、`infra/alchemy.run.ts` の `adopt` の分岐、`infra/check-worker.ts` の方式の引数 (`iac-drift.yml` の `gate` も)、`src/__tests__/infra-stages.test.ts` と `src/__tests__/deploy-environments.test.ts` の `adopt` の試験、この runbook の 5〜6 の手順

## 今の値の無い secret を作り直す

切り替えで全員が一度ログアウトし、MFA の利用者は認証アプリを登録し直す。先に `select user_id from mfa_totp where verified_at is not null` で MFA の利用者を見て、この手間で捌けるかを決める。本番の DB は Hyperdrive `taimei-auth-prod` の接続先の database `auth` で、Neon の既定の `neondb` ではない (別の database を見ると、行が無いと誤って読み、下の `<N>` を前の鍵と同じ version にしてしまう)。VPN を付けたままでは、手元からの接続が時間切れになることがある。

1. 新しい値を作る。`AUTH_SECRET` と `AUTH_SERVICE_KEY` は `openssl rand -hex 32`。`MFA_TOTP_ENCRYPTION_KEYS` は `v<N>:` に続けて `openssl rand -base64 32` の値で、`<N>` は `select max(key_version) from mfa_totp` より大きい数にする。消し忘れた MFA の行は、鍵の version が無いとはっきり失敗する
2. 手順 7 で 0% に加えたら、MFA の利用者ごとに `DATABASE_URL=<本番の接続文字列> AUTH_SECRET=<新しい値> bun run management/disable-user-mfa.ts <userId>` を流す (本人に通知のメールが届く。`AUTH_RESEND_KEY` が無いと `notified: false` になる)
3. 手順 7 の確認は、今のログインが続くことの代わりに、override header を付けたブラウザで新しくログインできることと、MFA を登録してログインできることを見る。登録した MFA の行は新しい鍵で暗号化され、100% の前の version では読めないので、確かめたらすぐ `<new>@100%` にする
4. `AUTH_SERVICE_KEY` を作り直した時は、`<new>@100%` の直後に taimei の `AUTH_SERVICE_KEY` を同じ値にして deploy する。taimei の deploy が終わるまで、taimei から auth への RPC は 401 になる (今の値が無いので、新旧の両方を受け付ける期間を作れない)
5. 100% にした後、ほかの MFA の利用者に認証アプリを登録し直してもらう

## 0% の version を手で確かめる

1. tree の中で `DEPLOY_MODE=gate bunx alchemy deploy infra/alchemy.run.ts --stage production`
2. `bunx wrangler versions list --name taimei-auth --json` の最後の id を `<new>`、`bash scripts/current-version-id.sh taimei-auth` を `<current>` とし、`bunx wrangler versions deploy <new>@0% <current>@100% --name taimei-auth --yes`
3. `bash scripts/preview-smoke.sh https://auth.taimei-code.com taimei-auth <new> public`。ブラウザで確かめる時は、拡張で `Cloudflare-Workers-Version-Overrides: taimei-auth="<new>"` を付ける
4. `<new>@100%` か `<current>@100%` で終える (手順 7 で `<current>` に戻す時は、手順 7 の rollback を使う)

## 日々の変更

- 資源と binding の変更は `infra/` の定義を変える PR で行い、main の push の Deploy が staging、本番の順に出す
- Durable Object の追加・改名・削除は 0% では出せない。merge の後に `Deploy production at 100%` (`deploy-production-full.yml`) を main から起動する。DO の binding を表から消すと、データごと namespace が消える
- `Deploy production at 100%` の後は、`Deploy` (`deploy.yml`) を main から手動で起動し、0% で出して確かめる deploy を一度流す。100% の deploy は state に 0% の指定の無い Worker を残し、`IaC drift` は 0% の deploy の定義と比べるので、次の main の push まで差として報告し続けるためである
- secret の値は Secrets Store で変える。`wrangler secret put` と、定義を通さない `wrangler deploy`・`wrangler versions upload` は使わない (Secrets Store の binding を持たない version ができる)
- `alchemy destroy --stage production` は使わない。DO のデータ (session) ごと消える
- `IaC drift` が落ちたら、出力の差を見て、定義に戻すか定義を直す PR を出す。dashboard で足した var と `wrangler secret put` の secret は alchemy の deploy では消えないので、dashboard で消す。外れた custom domain は alchemy の deploy で付け直る (どの検査が何を拾うかは ADR-0022 の予行演習の R6)

## IaC の外に残るもの

| もの | 理由 |
|---|---|
| Secrets Store の値 | 値を定義・state・CI に通さない (ADR-0022 の Decision 11) |
| Hyperdrive `taimei-auth-prod` | 接続の password を state に入れない。定義は名前で引く (Decision 14) |
| Neon の project・DB・role | project を作れる key は本番の DB にも届くので CI に置かない (Decision 21) |
| Worker が DB に接続する role | 今は owner で接続している。権限を絞るのは別の issue で行う |
| zone `taimei-code.com` の custom domain 以外の DNS と、Resend の送信 domain | Worker の資源ではなく、taimei と共有している |
| GitHub の Environment と Cloudflare の token | token を作る権限を CI に渡さない |
| `wrangler.jsonc` | local の開発 (`wrangler dev`) と、本番の bundle の build (`wrangler versions upload --dry-run`) に使う。本番の token は Environment `production` にだけあり、手元に置かないので、この設定で本番に出す経路は人の手作業だけになる |
| alchemy の state の置き場 (`alchemy-state-store`) | 最初の deploy が作る。消すと state を失う |
