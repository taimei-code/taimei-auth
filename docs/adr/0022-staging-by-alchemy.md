# ADR-0022: staging は開発者だけが入れる本番以外の環境として、別の Cloudflare アカウントに alchemy v2 で宣言する

## Status

Accepted (2026-10-31)。判断主体は maintainer。実装は taimei-code/taimei-auth#308。本番の資源の取り込みは #309 で行い、この ADR の定義に本番の stage を足す。taimei (consumer app) も同じ道具と同じ形に従う。#308 の受け入れ基準のうち「アカウント選択画面を staging に出さない」は、この ADR の Decision 7 (staging に開発者ホームと試験 API を載せる) に置き換わる。

関連: ADR-0004 (cookie)、ADR-0011 (Workers 移行)、ADR-0017 (Effect。`@effect/platform-bun`・`@effect/platform-node` の扱いを #308 の実装の PR で改訂する)、ADR-0021 (本番の成果物に本番以外の code を入れない)、GLOSSARY.md の **staging** と **本番以外**。

## Context

taimei-auth と taimei の環境は本番と開発環境だけで、本番の前に、本番に近い構成で確かめる場所が無い。本番の資源は dashboard と `wrangler secret put` の手作業で作られていて、同じものをもう一度作れる保証も無い。

staging は開発者が使う場所なので、**開発者ホーム** と **試験 API** を載せて、**開発用アカウント** や任意の利用者にすぐなれるようにする。本番の成果物には、これまでどおりそれらを入れない (ADR-0021)。

IaC の道具は PoC (#367) で alchemy v2 と OpenTofu を比べ、alchemy v2 を選んだ。型や参照で結ばれない文字列が少なく、存在しない参照を plan で止め、増える言語も無いからである。代わりに成熟度では劣る (直近 90 日の release の過半に破壊的変更がある)。prototype (#368) で、この repo の check・audit・build・smoke gate に合うことを確かめた。

主な脅威は次の 3 つである。注意ではなく、構造で届かないようにする。
- 人か LLM の過失で、staging の操作が本番に届くこと。
- 試験 API を載せた成果物が本番に出ること。
- secret が定義・repo・state・ログに漏れること。

## Decision

### 道具と置き場所

1. **alchemy は root の devDependency にし、版を `2.0.0-beta.84` に固定する**。入れるのは `alchemy`、`@alchemy.run/cloudflare`、CLI が Bun で読む peer の `@effect/platform-bun`、`@alchemy.run/cloudflare` の Worker の資源が静的に import する peer の `@effect/platform-node` の 4 つ。platform-node は optional の peer と書かれているが、無いと定義を読めない (2026-10-31 の最初の deploy で観測)。
   - overrides は要らない (beta.84 で `bun audit` の high 以上が 0 件)。`minimumReleaseAge` は外さない。
   - 定義は `infra/` に置く。`infra/` にも src などと同じ規則を当てる (コメント禁止、tsconfig、fallow の entry、依存の許可リスト。prototype の変更と同じ)。
2. **定義は `infra/alchemy.run.ts` の 1 本にし、stage ごとの差は `infra/stages.ts` の表に集める**。
   - 表の key は stage 名で、#308 では `staging` だけを置き、#309 で `production` を足す。stack は CLI の `--stage` を表の key として parse し、表に無い stage では何も作らずに止まる。
   - 表の値に置くのは、Worker の名前、vars の値、入口 (Decision 7)、Hyperdrive の名前だけである。資源の種類と binding の数は、stage で変えない。例外は custom domain で、本番だけが持つ。#309 で表に足す。
3. **state の置き場は repo ごとに分ける** (`Cloudflare.state({ name: "taimei-auth" })`。taimei は `{ name: "taimei" }`)。
   - 一方の repo が alchemy の版を上げ下げしても、もう一方の置き場は書き換わらない。`deploy --yes` は置き場の版が client と違うと、その client の版で置き場を作り直すからである。
   - 置き場は、最初の CI の deploy (`--yes`) が作る。

### 分離

4. **staging は本番と別の Cloudflare アカウントに置く**。
   - Cloudflare の token は Worker 単位に絞れず、Workers Scripts Edit はアカウント全体に効く。アカウントを分けると、token、state の置き場、Secrets Store、Free 枠がそろって分かれる。
   - staging のアカウントの token では、本番の資源も state も読めないことを PoC で確かめた。
5. **staging の DB は本番と別の Neon project に置く**。Neon の branch は親の role と password を引き継ぐので、同じ project の branch にすると、staging から本番の DB に owner で入れる。
6. **staging の URL は workers.dev にし、名前は本番と分ける**。
   - auth は `taimei-auth-staging` (`https://taimei-auth-staging.taimei-staging.workers.dev`)、app は `taimei-staging` (`https://taimei-staging.taimei-staging.workers.dev`)。Hyperdrive は `taimei-auth-staging`。
   - custom domain (`routes`) は書かず、`workersDev` を有効にする。
   - 本番以外の worker は本番の name を持たない (ADR-0021 の Decision 4)。staging の定義を本番のアカウントの credential で deploy しても、本番の Worker は置き換わらず、route の無い別の Worker ができるだけで済む。
   - Public Suffix List に載っているのは `workers.dev` だけなので、`taimei-staging.workers.dev` が cookie を付けられる domain の単位になる。`AUTH_COOKIE_DOMAIN=taimei-staging.workers.dev` で、auth と app が cookie を共有できる (ADR-0004)。本番の cookie は staging に届かず、staging の cookie も本番に届かない。

### 成果物

7. **本番と staging は別の入口から build する**。
   - **本番**: 今と変えない。本番以外の dir を外した tree から build し、bundle を検査する (ADR-0021)。
   - **staging**: 本番以外の入口 `testing/staging-worker.ts` から build する。
     - 本番の `createWorker` に、試験 API と開発者ホームの route (`mountNonProductionRoutes`) を足す。e2e のログイン用の試験 API は載せない (定数 `TAIMEI_AUTH_E2E_LOGIN_LINKS` を渡さない)。
     - メールは Decision 12 の送り手で送る。
   - worker は `wrangler versions upload testing/staging-worker.ts --config testing/wrangler.jsonc --dry-run --outdir staging-bundle` で bundle を作る。redirect 先の module の差し替えは、`testing/wrangler.jsonc` の `alias` がそのまま行う。
   - web は既存の `bun run build:web:non-production` で build する。
   - 定義は `bundle: false` で、この bundle をそのまま上げる (検査した bundle と上がる bundle が同じであることを、prototype で確かめた)。
8. **本番以外の redirect 先の module (`testing/redirect-hosts.ts`) に、staging の 2 つの host を完全一致で足す**。本番以外の環境が 1 つの module を共有するので、staging のための alias も設定 file も増えない。本番の module (`src/redirect-hosts.ts`) は変えない。
9. **本番以外の入口が動く条件を「local か staging」に広げる。本番では今と同じく必ず止まる**。
   - `APP_ENV`: 本番以外の入口が応答してよい値 (`testing/serve-only-outside-production.ts`) に `staging` を足す。
   - DB: staging の入口は、DB に「本番以外の DB」の印の表 (`non_production_database`) が無ければ応答しない。
     - Worker から見える Hyperdrive の接続文字列には Neon の host が出ないので、local の入口と同じ host の照合 (`requireLocalDatabase`) は使えない。
     - 印は staging の runbook の SQL だけが作り、migration には入れない (本番の deploy でも migration は流れるため)。本番の DB に印は無いので、staging の bundle が本番の DB につながっても止まる。
   - local の入口は、今の host の照合のままにする。
10. **staging の前に Cloudflare Access を置き、開発者の認証を通った人だけを通す**。
    - 試験 API で誰にでもなれるので、Access が staging の入口の守りになる。staging には本物の個人の情報を置かない。
    - CI の smoke と consumer の e2e は、Access の service token で通る。
    - smoke は、token の無い request が Access に止められることも確かめる。Access の設定が外れると、smoke が落ちる。

### secret とメール

11. **app の secret の値は IaC に通さない**。
    - 定義には Secrets Store の binding の名前だけを書く。名前は `src/secret-bindings.ts` の配列 1 つで宣言し、`infra/` はそれを import して binding を作る。値は人が Secrets Store に一度だけ入れ、定義にも state にも残らない (prototype で確かめた)。
    - staging に置くのは、動くのに必須の 4 つ (`AUTH_SECRET`・`AUTH_SERVICE_KEY`・`AUTH_RESEND_KEY`・`MFA_TOTP_ENCRYPTION_KEYS`) だけにする。GitHub ログイン、avatar の Blob、Sentry は無効のまま始め、要る時に名前を配列に 1 つ足す。
    - `AUTH_SERVICE_KEY` は、taimei の staging の Worker も同じ secret を binding する。
    - `src/worker.ts` の入口は、同じ配列にある名前の binding のうち `get(): Promise<string>` を持つものを、最初の request の前に値に解き、文字列の binding と同じように `process.env` に写す。`get` を持つかどうかだけでは選ばない (DO の namespace も `get` を持つ)。今の `copyEnvToProcess` は文字列しか写さないので、この変更が無いと app は secret を読めない。`src/` は環境を判定しない (ADR-0021 の Decision 1)。本番は #308 では文字列の secret のままで、同じ入口でそのまま動く。
12. **staging のメールは宛先で分ける**。
    - **開発用アカウント** の domain (`@example.com`) 宛ては、記録するだけで送らない。開発者ホームはその記録から link を取り出すので、選べる候補に足すのも記録する宛先の利用者だけにする。`example.com` はもともと届かない domain なので、失うものが無い。
    - それ以外は Resend で送る。送り元 (`AUTH_FROM_EMAIL_*`) は本番と同じにする。key は同じ Resend のアカウントで staging 用に別に作り、送信だけの権限にする。

### DB

13. **Worker は権限を絞った role `taimei_auth_worker` で DB に接続し、owner は migrate と本番以外の表の準備だけに使う**。
    - role は staging の runbook の SQL で一度だけ作る。`public` の table と sequence に読み書きの権限を与え、`ALTER DEFAULT PRIVILEGES` で後から migrate が作る table にも同じ権限を付ける。
    - role が `neon_superuser` の member でないことも、その SQL で確かめる。Neon の API で作る role は `neon_superuser` に入るので使わない。
14. **Hyperdrive は人が一度だけ `wrangler hyperdrive create` で作り、定義は `Cloudflare.Hyperdrive.lookup` で名前から引く**。
    - role の password は Hyperdrive の中にしか残らず、state にも GitHub にも置かない。
    - query cache は無効にする (作成直後の行が 60 秒見えなくなる不具合があるため)。
15. **本番以外の表の準備と開発用アカウントの用意 (`prepareNonProductionTables` と同じ中身) は、staging の deploy の job が owner で行う**。
    - Worker の role には DDL の権限が無いので、local の入口のように最初の request で準備することはできない。
    - 準備の script は、最初に印の表 (Decision 9) を確かめ、無ければ何もせずに失敗する。

### deploy の流れ

16. **staging は、#309 で本番が使う gate と同じ手順で出す**。
    - gate の手順は composite action (`.github/actions/gate-deploy`) にまとめる。手順は次の順。
      1. alchemy で `traffic: 0` の version を upload する。
      2. wrangler で 0% の deployment に加える。
      3. override header と Access の service token で smoke する。`scripts/preview-smoke.sh` は Worker の名前を引数で受け取り (今は `taimei-auth` が固定で書かれている)、Access の service token の header をすべての request に付ける。
      4. 通れば 100% に、落ちれば前の version に戻す。
    - #308 では staging の job だけがこの action を使う。本番の job は今の wrangler の手順のまま変えず、#309 で同じ action に替える。
    - staging の job は次の順に進む。
      1. checkout と install
      2. staging の bundle の build (Decision 7)
      3. 本番以外の DB の印の表の確認 (Decision 9)。印の無い DB には migrate も流さない
      4. migrate (`db:migrate` と `db:migrate-manual`)
      5. 本番以外の表の準備 (Decision 15)
      6. gate-deploy
    - DO の追加・改名・削除と最初の作成は 0% では出せない (`WorkerVersionConfigError`。0% の upload には 100% の version が先に要る)。staging でも、手動の dispatch で 100% に出す workflow を別に置く (本番の `deploy-durable-object-migration.yml` と同じ形)。この workflow も、最後に token の無い request が Access に止められることを確かめる。
    - stack は deploy の方式を env の `DEPLOY_MODE` (`gate` か `full`) で受け取り、それ以外の値では止まる。
17. **deploy は `deploy.yml` の 1 本で、staging の job が通った時だけ本番の job に進む** (本番の job に `needs: staging` を付ける)。
    - 起動の条件は今と同じ (main の CI の成功か、main での手動の dispatch)。dispatch に入力欄は設けず、staging を飛ばす経路は作らない。stage 名と branch は workflow に固定で書く。
    - staging と本番の job は同じ commit を checkout する (`workflow_run` の `head_sha`、手動の dispatch では起動した時の `github.sha`)。staging の job を待つ間に main が進んでも、本番は staging が確かめた commit を出す。
    - staging と本番の job には、それぞれ job の `concurrency` を付ける。alchemy には lock が無く、同時に deploy すると後から出した方が残る。
    - staging が壊れると、本番の deploy も止まる。staging の修正の deploy で直す。
18. **GitHub の secret は Environment で job ごとに分け、repo 全体の secret は空にする**。
    - Environment `production`: 今の 3 つ (`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`・`DATABASE_URL`) を移し、使える branch を main に絞る。`deploy.yml` の本番の job と `deploy-durable-object-migration.yml` が使う。
    - Environment `staging`: staging のアカウントの `CLOUDFLARE_API_TOKEN` (Workers Scripts・Secrets Store の Edit、Hyperdrive の Read、Account Settings の Read) と `CLOUDFLARE_ACCOUNT_ID`、staging の owner の `DATABASE_URL`、Access の service token (`ACCESS_CLIENT_ID`・`ACCESS_CLIENT_SECRET`) を置く。使える branch は main に絞る。
    - 1 つの job が持てる Environment は 1 つなので、staging の job から本番の secret は読めない。
    - `environment: production` を書いてよい job を `src/__tests__/deploy-environments.test.ts` が固定する。collaborator が 1 人なので、CODEOWNERS や必須の review は関門にならず、試験で止める。管理者の権限で CI を迂回する merge までは止めない。
19. **taimei から auth への service binding は名前で書く** (`worker.bind` に `type: "service"` と `taimei-auth-staging`)。アカウントが分かれているので、staging の app は staging の auth しか指せない。名前を誤ると、Cloudflare が deploy の時に拒む。

### 試験で固定すること

20. 次の試験を足す。
    - **DO の削除を止める**: 定義の DO の binding (`KV_STORE` → `KvStore`) が `wrangler.jsonc` の `durable_objects` と同じであること。alchemy は binding を外すとデータごと namespace を消し、plan には `update` としか出さない。`RemovalPolicy.retain` も binding の削除には効かない (prototype で観測)。
    - **定義と本番の設定がずれない**: 表の各 stage の vars の key が、`wrangler.jsonc` の vars の key と同じであること。secret の名前が `scripts/wrangler-dev.sh` の渡す名前の一覧にあること。
    - **staging の入口が本番で動かない**: `APP_ENV=production` では応答しないことと、印の表が無い DB では応答も準備もしないこと。
    - **redirect 先が広がらない**: 本番以外の module に足した staging の host が完全一致であること (workers.dev の wildcard を許さない)。
    - **メールの振り分け**: `@example.com` 宛てだけが記録され、それ以外は送り手に渡ること。
    - **Secrets Store の binding が届く**: 入口 (Decision 11) が binding を値に解くこと。
    - **本番の secret を使える job を限る**: Decision 18 の試験。
    - **本番の成果物は変わらない**: 既存の `scripts/check-production-bundle.sh` と `src/__tests__/production-tree.test.ts` をそのまま通す。

### 人が一度だけ行う作業 (IaC にしない理由つき)

21. 次は人が行い、手順を `docs/runbook/staging.md` に書く。
    - **Cloudflare のアカウント**: staging のアカウントの作成と、workers.dev のサブドメイン `taimei-staging` の登録 (済み)。アカウントの作成は API に無い。
    - **Neon project**: 作成し、owner の接続文字列 (直接接続) を Environment `staging` に置く。project を作れる Neon の key は本番の project にも届くので、CI に置かない。
    - **DB**: Worker の role と印の表を作る SQL を流す (Decision 9・13)。印の表を migration に入れないためと、role の password を repo にも CI にも置かないためである。
    - **Hyperdrive**: `wrangler hyperdrive create` で作る。password を state に入れないためである。
    - **Secrets Store**: 作成し、4 つの secret を登録する。値を IaC に通さないためである。
    - **Access**: Zero Trust の組織の作成と、staging の Worker の workers.dev への Access の適用、開発者の許可、service token の発行。
    - **GitHub**: Environment の作成と、secret の移動。
    - **最初の deploy**: gate の経路は Worker が無いと動かないので、`deploy.yml` に staging の job を入れる前に、手動の 100% の workflow (Decision 16) を一度流す。`destroy` の後も同じ。
22. 完了の確認として、staging を一度 `alchemy destroy --stage staging` で消し、手動の 100% の workflow で作り直す。
    - 手作業の資源 (Neon project、Hyperdrive、Secrets Store、Access) は残る。ほかはすべて定義から作り直せることを確かめる。
    - taimei の staging があるときは、app を先に消して auth を後に消し、作るときは auth を先にする。auth を先に消すと、app の service binding が消えた script を指したまま残り (HTTP 1101)、auth を作り直しても alchemy の plan は `no changes` を返して気づかない (PoC で観測)。その場合は app を deploy し直す。

## Considered Options

- **OpenTofu**: 必須の条件はすべて満たし、成熟度で上回る。型や参照で結ばれない文字列が多く (alchemy の 4 個に対し 11 組)、誤った参照が apply まで止まらず、HCL が増えるので選ばなかった。
- **staging に本番と同じ成果物を出す**: 本番と同じものを確かめられるが、開発者ホームと試験 API が使えない。
- **staging の Worker の名前を本番と同じにする**: smoke の script が変わらないが、試験 API を載せた bundle が本番の credential で本番の Worker を置き換えうる (ADR-0021 の Decision 4)。
- **staging を公開のままにする**: 試験 API で誰でも staging の利用者になれる。
- **staging の DB を host で見分ける**: Worker から見える Hyperdrive の接続文字列には、Neon の host が出ない。
- **staging を本番と同じアカウントにする、または本番の DB の branch にする**: token がアカウント全体に効き、branch は親の owner の password を引き継ぐ。
- **2 つの repo で state の置き場を共有して `Worker.ref` で参照する**: 型で参照できるが、一方の repo の alchemy の版でもう一方の置き場が作り直され、stack 名も黙って衝突する。
- **Hyperdrive を定義で作る**: 定義から作り直せるが、role の password が state と GitHub に入る。
- **secret を alchemy の `Secret` か `wrangler secret put` で入れる**: `Secret` は値が state に入る。`wrangler secret put` の値は、gate の経路 (version の upload) のたびに消える (prototype で観測)。
- **staging と本番を独立した workflow にする、または任意の branch を staging に出せるようにする**: 壊れた migrate や deploy が本番まで進みうる。branch を出せると、staging の DB が main より先に進む。
- **本番の secret を使える job を、CODEOWNERS か必須の承認者で限る**: collaborator が 1 人なので、CODEOWNERS は管理者の迂回でしか merge できなくなり、関門にならない。必須の承認者は、本番の deploy が毎回手作業になる。
- **Neon project を alchemy で作る**: 作り直せる範囲は広がるが、本番の project にも届く Neon の key が staging の job に入る。

## Consequences

- staging は **本番以外** の環境で、本番と同じ成果物ではない。本番の成果物そのものは、本番の gate の smoke で確かめる。
- staging の障害の間は、本番にも deploy できない。
- Access の設定が staging の守りの要になる。外れると試験 API が公開されるので、smoke が毎回、token の無い request が止まることを確かめる。
- **費用**: staging のアカウントは Free のままにする。Workers、workers.dev、Secrets Store、alchemy の state の置き場は、Free のアカウントで課金の表示なしに作れた (PoC で観測)。Neon は Free の project を 1 つ増やす (Free は 100 project まで)。Hyperdrive と Zero Trust (Access) の Free での作成は観測していない。作れないか支払い手段の登録が要るなら、費用と代わりの案を #308 に示して判断を仰ぐ。
- 本番のメールの送信枠を staging と共有する。staging は Access で閉じるので、外からの濫用で枠が減ることはない。
- DO の変更 (追加・改名・削除) は、#309 の後は alchemy だけで行う。wrangler の migration と併用できない (取り込んだ後に wrangler の `renamed_classes` が拒まれた)。#309 で `deploy-durable-object-migration.yml` を置き換える。
- alchemy は beta なので、上げるたびに破壊的変更を確かめる。state の置き場は repo ごとなので、2 repo で版を同時に上げる必要は無い。
- Workers Scripts Edit と Secrets Store の権限を持つ token は、そのアカウントの secret の値を読める (alchemy は preview の Worker を上げて読む)。staging の token は、staging の secret をすべて読めるものと考える。
- 実装の最初に確かめること (prototype で観測していない)。どれかが通らなければ、そこで戻って判断を仰ぐ。
  - `2.0.0-beta.84` の `Hyperdrive.lookup` が名前で引けるか
  - 人が作った Secrets Store を、`SecretsStore.Store` が取り込むか
  - 空のアカウントで、CI の `deploy --yes` が state の置き場を作るか
  - `type: "service"` の binding が、名前で別の Worker を指せるか。名前を誤ったときに deploy が止まるか
  - workers.dev の Worker の前に Access を置けるか。service token で smoke と e2e が通るか。Worker を消して作り直しても Access の適用が残るか
  - `wrangler versions upload <entry> --config testing/wrangler.jsonc --dry-run` が、`alias` を当てた bundle を作るか
  - 権限を最小にした token (Decision 18) で deploy が通るか
  - Worker の role で、app と試験 API のすべての query が通るか (staging の smoke と e2e で見る)
  - Free のアカウントで、Hyperdrive と Zero Trust を作れるか
