# 本番の取り込みと、IaC の外に残る手作業

本番の資源は `infra/alchemy.run.ts` の stage `production` で宣言する。判断の理由は [ADR-0022](../adr/0022-staging-by-alchemy.md) の「#309 で足したこと」にある。

## 前提

- 本番のアカウント (`taimei-production`) の token の権限: Workers Scripts Edit、Secrets Store Edit、Workers Routes Edit (custom domain)、Zone Read、Hyperdrive Read、Account Settings Read。Environment `production` の `CLOUDFLARE_API_TOKEN` もこの権限にする
- 手元で本番の token を使うのは「1 回だけの手順」の間だけにする。短い期限の token を作り、終わったら消す。手元の `ALCHEMY_HOME` は一時 dir にし、終わったら消す (state の置き場の token が cache される)

## 1 回だけの手順

2026-11-04 に済んだ。記録として残す。

taimei の本番は Worker の名前 `taimei-auth`、`AUTH_SERVICE_KEY` の値、custom domain に依存している。どれも変えない。取り込みから merge まで、main に他の PR を merge しない (main の deploy はまだ wrangler の経路で、Secrets Store の binding を落とす)。

1. 予行演習: 本番のアカウントに、wrangler で使い捨ての Worker (custom domain・SQLite の DO・`secret_text`・vars つき) を作り、repo の外に写した定義で ADR-0022 の R1〜R7 を確かめる。終わったら Worker・custom domain・Secrets Store の secret を消す。どれかが通らなければ止める
2. 棚卸し: 本番の 8 つの secret の値を持っているか確かめる。`AUTH_SECRET` と `MFA_TOTP_ENCRYPTION_KEYS` は今の本番と同じ値でなければならない (`AUTH_SECRET` が違うと全員がログアウトし、`MFA_TOTP_ENCRYPTION_KEYS` が違うと MFA の利用者がログインできなくなる)。この 2 つと `AUTH_SERVICE_KEY` の値が無ければ、下の「今の値の無い secret を作り直す」で作り直すか、止める (`service-key-rotation.md` は今の値を `AUTH_SERVICE_KEY_PREVIOUS` に入れるので、値が無いと使えない)。`AUTH_RESEND_KEY`・`AUTH_GITHUB_SECRET`・`BLOB_READ_WRITE_TOKEN` は発行し直してよい。`AUTH_GITHUB_ID` と `SENTRY_DSN` は各サービスの画面で読める
3. 本番の Secrets Store (無ければ作る) に 8 つの secret を、`src/secret-bindings.ts` の名前で入れる
4. 本番の tree を作る: `bash scripts/build-production-tree.sh <空の dir>`。tree は HEAD から作るので、先に PR の branch の変更を commit する。以下は tree の中で行う
5. 取り込みの前の確かめ (済み。取り込みの方式 `adopt` は消した)
6. 取り込み (済み。2026-11-04 に version `7a3016eb` で行った)
7. secret の切り替え: 下の「0% の version を手で確かめる」で Secrets Store の binding を持つ version を 0% に加え、override header を付けたブラウザで、今のログインが続くこと、MFA の利用者がログインできること (QA-MR-06) を確かめる。通れば `<new>@100%`、だめなら `bunx wrangler rollback <current> --name taimei-auth --yes` で戻して止める。`versions deploy <current>@100%` は、secret が変わったとして拒まれる (code 10220)。rollback は同じ確認を出して進め、前の version は自分の `secret_text` で動き続ける
8. `bun infra/check-worker.ts production` が通る → PR を merge → Deploy の staging と本番の job が通る → `IaC drift` を手動で起動して差が無い

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

## Worker の DB の role

Worker は権限を絞った role `taimei_auth_worker` で DB に接続し、owner は migrate だけに使う (ADR-0022 の Decision 13)。role を作り、Hyperdrive `taimei-auth-prod` の接続先をこの role に替える手順である。role を作り直す時も同じ手順を使う。

接続先の database と VPN の注意は「今の値の無い secret を作り直す」と同じである。password は会話にも shell の履歴にも出さず、確かめが終わったら手元から消す (password は Hyperdrive の中にだけ残る。ADR-0022 の Decision 14)。

1. role を作る前に、owner (Environment `production` の `DATABASE_URL`) で次を確かめる。どれかが違えば止める
   - `SELECT current_user` と `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'` が同じ 1 つの role (以下 `<owner>`、今は `neondb_owner`)。違うと `ALTER DEFAULT PRIVILEGES` が migrate の作る table に効かず、次の migration の後に Worker が新しい table を読めない
   - `SELECT to_regclass('public.non_production_database') IS NULL` が `true` (本番の DB に本番以外の DB の印が無い)
2. password を手元で生成し (`openssl rand -hex 24`)、owner で次の SQL を流す。role が既にあり、Hyperdrive がまだ指していない時は、`CREATE ROLE` の代わりに `ALTER ROLE taimei_auth_worker PASSWORD '<password>'` を流す。Hyperdrive が指した後は、password を替えると本番が止まるので、Hyperdrive の update と続けて行う (`DROP ROLE` もしない)。password を平文で渡す理由は staging の runbook の 3 節にある。staging の印の SQL は流さない

```sql
CREATE ROLE taimei_auth_worker LOGIN PASSWORD '<password>';
GRANT USAGE ON SCHEMA public TO taimei_auth_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taimei_auth_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taimei_auth_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taimei_auth_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO taimei_auth_worker;
SELECT
  pg_has_role('taimei_auth_worker', 'neon_superuser', 'MEMBER') AS must_be_false,
  has_schema_privilege('taimei_auth_worker', 'public', 'CREATE') AS must_be_false_too,
  has_database_privilege('taimei_auth_worker', current_database(), 'CREATE') AS must_be_false_as_well;
```

最後の `SELECT` が 3 つとも `false` であることを確かめる。`pg_has_role` が `true` なら、Hyperdrive が指す前なので role を消し、SQL で作り直す (staging の runbook の 3 節と同じ)。CREATE の 2 つが `true` なら止めて判断を仰ぐ (`REVOKE CREATE ON SCHEMA public FROM PUBLIC` は当てない。Postgres 14 以前は schema `public` の owner が `postgres` で、owner の migrate まで止めうる)
3. Hyperdrive を替えると 100% の Worker にすぐ効くので、先に権限を確かめる。どれかが期待と違えば替えない。まず owner で次の SQL を流し、0 行であることを確かめる。`public` のすべての table と sequence について、Worker の role に足りない権限を 1 行ずつ返す (table の名前を書かないので、migration で table が増えても漏れない)。`has_table_privilege` に権限をカンマで並べると、どれか 1 つを持つだけで true になるので、権限ごとに確かめる

```sql
SELECT c.relname, p.privilege
FROM pg_class c
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(privilege)
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
  AND NOT has_table_privilege('taimei_auth_worker', c.oid, p.privilege)
UNION ALL
SELECT c.relname, p.privilege
FROM pg_class c
CROSS JOIN unnest(ARRAY['USAGE', 'SELECT']) AS p(privilege)
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
  AND NOT has_sequence_privilege('taimei_auth_worker', c.oid, p.privilege);
```

続けて、`taimei_auth_worker` の接続で次を流す。接続文字列は owner の `DATABASE_URL` の user と password を `taimei_auth_worker` と生成した値に替えたもので、手元から bun と `pg` で接続する (Neon の SQL Editor は owner で動くので使えない)
   - `BEGIN` の後に `UPDATE "user" SET name = name || 'x' WHERE id = (SELECT id FROM "user" LIMIT 1)` と `UPDATE account SET password = coalesce(password, '') || 'x' WHERE id = (SELECT id FROM account LIMIT 1)` が通り、`ROLLBACK` する (値を変えて trigger を発火させる。`"user"` を更新する trigger は呼び手の権限で動く)
   - `SELECT pg_advisory_xact_lock(0)` が通る
   - `BEGIN` の後の `CREATE TABLE ddl_probe (x int)` が SQLSTATE `42501` (permission denied) で失敗し、`ROLLBACK` する (成功してしまった時も table を残さない)
4. Hyperdrive の update は Environment `production` の token (Hyperdrive Read) ではできないので、手元の wrangler の OAuth で行う。shell に `CLOUDFLARE_API_TOKEN` を置かず (OAuth より優先される)、本番のアカウントにログインしていることを `bunx wrangler whoami` で確かめ、`bunx wrangler hyperdrive get <id>` で今の origin (host・port・database・user) と `caching.disabled` を控える。`<id>` は `wrangler.jsonc` の hyperdrive の id である。次のコマンドで切り替える。接続文字列をまるごと渡す形は使わない (host まで上書きする)。caching の flag を渡さなければ caching の設定は変わらない
   - `bunx wrangler hyperdrive update <id> --origin-user taimei_auth_worker --origin-password "$WORKER_PASSWORD"` (先に `read -rs WORKER_PASSWORD` で生成した値を読む。コマンドの行に password を書くと shell の履歴に残る)
   - もう一度 `hyperdrive get` で、user が `taimei_auth_worker`、host・port・database が控えと同じ、`caching.disabled` が `true` であることを確かめる
5. `https://auth.taimei-code.com/health` の DB が ok であることを確かめ、10 分以内に、owner で `SELECT usename, count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() GROUP BY 1` が `taimei_auth_worker` を含み、`<owner>` を含まないことを見る。`<owner>` の行が残る時は、`client_addr`・`application_name`・`backend_start` で接続元 (CI の migrate、Neon の画面、切り替え前の Hyperdrive の接続) を見て判断する。接続の一覧だけを理由に戻さない (`/health` は `SELECT 1` しか流さないので、権限は手順 3 と QA で確かめる)。続けて QA-MR-01・QA-MR-06・QA-MR-10 を行う (QA-MR-10 は事業所の作成の書き込みと、その直後の読み取りを確かめる)
6. `/health` の DB が error か、QA-MR-01・QA-MR-06・QA-MR-10 のどれかが通らなければ、すぐ owner に戻す: `bunx wrangler hyperdrive update <id> --origin-user neondb_owner --origin-password "$OWNER_PASSWORD"` (`read -rs OWNER_PASSWORD` で owner の password を読む。GitHub の secret は読み返せないので、Neon の画面の接続情報から取る)

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
| Worker が DB に接続する role (`taimei_auth_worker`) | role の password を repo にも state にも置かない (Decision 14)。作り方は「Worker の DB の role」 |
| zone `taimei-code.com` の custom domain 以外の DNS と、Resend の送信 domain | Worker の資源ではなく、taimei と共有している |
| GitHub の Environment と Cloudflare の token | token を作る権限を CI に渡さない |
| `wrangler.jsonc` | local の開発 (`wrangler dev`) と、本番の bundle の build (`wrangler versions upload --dry-run`) に使う。本番の token は Environment `production` にだけあり、手元に置かないので、この設定で本番に出す経路は人の手作業だけになる |
| alchemy の state の置き場 (Worker `alchemy-state-store-taimei-auth`) | 最初の deploy が作る。消すと state を失う |
