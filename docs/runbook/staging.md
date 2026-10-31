# staging の手作業と作り直しの手順

**staging** (定義は [`GLOSSARY.md`](../../GLOSSARY.md)) のうち、IaC の定義 (`infra/alchemy.run.ts`) に載せない資源を人が作る手順と、staging を消して作り直す手順である。何を定義に載せ、何を載せないかの判断は [ADR-0022](../adr/0022-staging-by-alchemy.md) にある。各節の「載せない理由」は ADR の Decision 21 の要約で、判断を変える時は ADR を先に直す。

## 前提

- staging は本番と別の Cloudflare アカウントと、本番と別の Neon project に置く
- 本番の資源と本番の credential には、この手順のどこでも触れない
- 値 (password・token・secret) は手元の端末で生成し、この文書・repo・issue・チャットに書かない

## 1. Cloudflare のアカウント

- staging のアカウントを作り、workers.dev のサブドメインを `taimei-staging` で登録する (作成済み)
- 載せない理由: アカウントの作成は Cloudflare の API に無い

## 2. Neon project

1. Neon で staging 用の project を作る (Free の project)
2. owner の直接接続の接続文字列 (pooler でないもの) を控える。7 節で GitHub の Environment `staging` の `DATABASE_URL` に入れる

- 載せない理由: project を作れる Neon の key は本番の project にも届くので、CI に置かない

## 3. DB の SQL (Worker の role と本番以外の DB の印)

2 の project の DB に owner で接続し、次の SQL を流す。`<owner>` は project の owner の role、`<password>` は手元で生成した値に置き換える。

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

1. Zero Trust の組織を作る
2. staging の Worker (`taimei-auth-staging`) の workers.dev に Access を適用し、開発者だけを許可する
3. CI の smoke と consumer の e2e のために service token を発行し、application の policy で service token を許可する (Service Auth)
4. token の無い request が止まることを確かめる: `curl -i https://taimei-auth-staging.taimei-staging.workers.dev/health` が 302 (`*.cloudflareaccess.com` へ) か 403 を返す

- smoke は毎回 4 と同じことを確かめる (`scripts/preview-smoke.sh` の `access`)。Access を staging の守りにする理由は ADR-0022 の Decision 10 にある
- 載せない理由: ADR-0022 の Decision 21

## 7. GitHub の Environment と secret

次の順で行う。順を守れば本番の deploy は止まらない。

1. Environment `staging` を作り、使える branch を `main` に絞る。次の secret を入れる
   - `CLOUDFLARE_API_TOKEN`: staging のアカウントの token (Workers Scripts と Secrets Store の Edit、Hyperdrive と Account Settings の Read)
   - `CLOUDFLARE_ACCOUNT_ID`: staging のアカウントの ID
   - `DATABASE_URL`: 2 の owner の接続文字列
   - `ACCESS_CLIENT_ID`・`ACCESS_CLIENT_SECRET`: 6 の service token
2. Environment `production` を作り、使える branch を `main` に絞る。repo 全体の secret と同じ 3 つ (`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`・`DATABASE_URL`) を入れる
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

- 手作業の資源 (Neon project、Hyperdrive、Secrets Store、Access) は消えずに残る。6 の Access の適用が残っていることを、6 の 4 で確かめる
- taimei の staging があるときは、消すのは app が先、作るのは auth が先にする。auth を先に消すと、app の service binding が消えた script を指したまま残り (HTTP 1101)、auth を作り直しても alchemy の plan が `no changes` を返す。その場合は app を deploy し直す
