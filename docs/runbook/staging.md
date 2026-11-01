# staging の手作業と作り直しの手順

**staging** (定義は [`GLOSSARY.md`](../../GLOSSARY.md)) のうち、IaC の定義 (`infra/alchemy.run.ts`) に載せない資源を人が作る手順と、staging を消して作り直す手順である。何を定義に載せ、何を載せないかの判断は [ADR-0022](../adr/0022-staging-by-alchemy.md) にある。各節の「載せない理由」は ADR の Decision 21 の要約で、判断を変える時は ADR を先に直す。

## 前提

- staging は本番と別の Cloudflare アカウントと、本番と別の Neon project に置く
- 本番の資源と本番の credential には、この手順のどこでも触れない
- 値 (password・token・secret) は手元の端末で生成し、この文書・repo・issue・チャットに書かない
- wrangler を使う shell では、staging のアカウントの `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を設定し、`bunx wrangler whoami` が staging のアカウントだけを出すことを確かめてから始める。手元の wrangler が本番にログインしていても、環境変数の token が使われる
- 0 ドルで作れない資源があれば、そこで止め、費用と代わりの案を示して判断を仰ぐ (ADR-0022 の Consequences)

## 1. Cloudflare のアカウント

- staging のアカウントを作り、workers.dev のサブドメインを `taimei-staging` で登録する (作成済み)
- 載せない理由: アカウントの作成は Cloudflare の API に無い

## 2. Neon project

1. Neon で staging 用の project を作る (Free の project)
2. owner の直接接続の接続文字列 (pooler でないもの) を控える。7 節で GitHub の Environment `staging` の `DATABASE_URL` に入れる

- 載せない理由: project を作れる Neon の key は本番の project にも届くので、CI に置かない

## 3. DB の SQL (Worker の role と本番以外の DB の印)

Worker の role の password を手元で生成する (`openssl rand -hex 24`)。4 節の Hyperdrive でも使う。

2 の project の Neon の SQL Editor (branch `main`、owner の database) で、次の SQL を流す。`<owner>` は project の owner の role (Neon の既定は `neondb_owner`)、`<password>` は生成した値に置き換える。

```sql
CREATE ROLE taimei_auth_worker LOGIN PASSWORD '<password>';
GRANT USAGE ON SCHEMA public TO taimei_auth_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taimei_auth_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taimei_auth_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taimei_auth_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO taimei_auth_worker;
CREATE TABLE non_production_database (marked_at timestamptz NOT NULL DEFAULT now());
SELECT pg_has_role('taimei_auth_worker', 'neon_superuser', 'MEMBER') AS must_be_false;
```

- 最後の `SELECT` が `false` を返すことを確かめる。`true` なら role を消し、Neon の画面や API ではなく SQL で作り直す (Neon の API で作る role は `neon_superuser` に入る)
- password は平文で渡す。Neon は hash した password を受け付けない (`Neon only supports being given plaintext passwords`)。psql の `\password` も手元で hash してから送るので使えない。SQL Editor の履歴に password が残るが、履歴を読めるのは project に入れる人で、その人は owner として DB を操作できるので、この role の password で増える権限は無い
- psql は、TLS を復号する proxy の内側からは Neon につながらない (proxy が Postgres の TLS の開始を通さない)。SQL Editor は HTTPS なので通る
- `non_production_database` は本番以外の DB の印である。staging の Worker と表の準備の script は、この表が無い DB では動かない。migration には入れない
- 載せない理由: 印の表を migration に入れないため。role の password を repo にも CI にも置かないため

## 4. Hyperdrive

Worker の role (`taimei_auth_worker`) の接続文字列で、staging のアカウントに Hyperdrive を作る。query cache は無効にする。

```bash
bunx wrangler hyperdrive create taimei-auth-staging \
  --connection-string="postgres://taimei_auth_worker:<password>@<host>/<db>?sslmode=require" \
  --caching-disabled
```

- 名前は `infra/stages.ts` の `hyperdriveName` と同じにする。定義は名前で引く (`Cloudflare.Hyperdrive.lookup`)
- 載せない理由: 定義で作ると role の password が state と GitHub に入る

## 5. Secrets Store

staging のアカウントに Secrets Store を作り、次の 4 つを `src/secret-bindings.ts` の `SECRET_BINDING_NAMES` と同じ名前で登録する。scope は Workers にする。

| 名前 | 値 |
|---|---|
| `AUTH_SECRET` | 手元で生成した値 (`openssl rand -hex 32`) |
| `AUTH_SERVICE_KEY` | 手元で生成した値。taimei の staging の Worker も同じ secret を使う |
| `AUTH_RESEND_KEY` | 本番と同じ Resend のアカウントで staging 用に作った、送信だけの権限の key |
| `MFA_TOTP_ENCRYPTION_KEYS` | `v1:` に続けて 32 byte の base64 (本番と別の値) |

- 名前を `SECRET_BINDING_NAMES` に足した時は、ここにも同じ名前で登録してから deploy する
- 載せない理由: 値を IaC の定義と state に通さないため

## 6. Access

Access の application と policy は定義 (`infra/alchemy.run.ts` の `access`) が Worker と一緒に作る。ここでは定義に載せないものだけを作る。

1. Zero Trust の組織を作り、Free プランを選ぶ。Free でも支払い手段の登録を求められる。表示が Free・0 ドルであることを確かめてから登録する
2. CI の smoke と consumer の e2e のために service token を 1 本発行する。7 節で GitHub の Environment `staging` に入れる。定義の policy はこの組織の service token をどれでも通すので (ADR-0022 の Decision 10)、ほかの service token は作らない

- smoke は毎回、token の無い request が 302 (`*.cloudflareaccess.com` へ) か 403 で止まることを確かめる (`scripts/preview-smoke.sh` の `access`)。Access を staging の守りにする理由は ADR-0022 の Decision 10 にある
- application を作った直後は、service token の request も数十秒 Access に止められる。smoke の再試行の間に通る
- Worker の Access タブや Self-hosted の application を手で作らない。Worker の Access タブの application は Worker を作り直すと効かなくなり、hostname を守る application があると、同じ宛先を持てないので、定義の application を作る deploy が `AccessDestinationConflict` で落ちる
- 載せない理由: ADR-0022 の Decision 21

## 7. GitHub の Environment と secret

次の順で行う。順を守れば本番の deploy は止まらない。

1. Environment `staging` を作り、使える branch を `main` に絞る。次の secret を入れる
   - `CLOUDFLARE_API_TOKEN`: staging のアカウントの token (Workers Scripts・Secrets Store・Access の apps と policies の Edit、Hyperdrive と Account Settings の Read)
   - `CLOUDFLARE_ACCOUNT_ID`: staging のアカウントの ID
   - `DATABASE_URL`: 2 の owner の接続文字列
   - `ACCESS_CLIENT_ID`・`ACCESS_CLIENT_SECRET`: 6 の service token
2. Environment `production` を作り (本番の job が参照した時に GitHub が作っていれば、それを開き)、使える branch を `main` に絞る。repo 全体の secret と同じ 3 つ (`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`・`DATABASE_URL`) を入れる
3. main で本番の deploy が Environment `production` の secret で通ることを確かめてから、repo 全体の secret を消す

- Environment の secret が無い間は、repo 全体の secret が使われる。そのため 1 と 2 の前に `environment:` を workflow に書いても本番の deploy は落ちない
- `environment: production` を書いてよい job は `src/__tests__/deploy-environments.test.ts` が固定する

## 8. 最初の deploy

gate の経路 (0% で upload して smoke する) は、100% の version が無いと動かない。次の順で出す。

1. staging の job を持たない PR を merge する
2. 1〜7 を終える
3. main から `Deploy staging at 100%` (`.github/workflows/deploy-staging-full.yml`) を手動で起動し、成功を確かめる
4. `deploy.yml` に staging の job と `needs: staging` を足す PR を merge する。以後は main の push ごとに staging、本番の順に進む

Durable Object の追加・改名・削除も 0% では出せないので、3 の workflow で出す。

## 9. 消して作り直す

定義から作り直せることを確かめる時と、staging が壊れて戻せない時に行う。

1. 手元で staging の credential を設定し、repo root で `DEPLOY_MODE=full bunx alchemy destroy infra/alchemy.run.ts --stage staging` を流す
2. main から `Deploy staging at 100%` を起動する
3. 開発者ホーム (`/dev-home`) から開発用アカウントでログインできることを確かめる

- 手作業の資源 (Neon project、Hyperdrive、Secrets Store、Zero Trust の組織と service token) は消えずに残る。Access の application は Worker と一緒に消え、2 で作り直される。2 の smoke が、作り直した application が効いていることを確かめる。1 と 2 の間は Worker が無いので 404 が返る
- 1 の出力に `Secrets (Cloudflare.SecretsStore) deleted` と出るが、alchemy の state から外しただけで、Secrets Store と中の secret は消えない (alchemy の `SecretsStore` の delete は何もしない)
- taimei の staging があるときは、消すのは app が先、作るのは auth が先にする。auth を先に消すと、app の service binding が消えた script を指したまま残り (HTTP 1101)、auth を作り直しても alchemy の plan が `no changes` を返す。その場合は app を deploy し直す
