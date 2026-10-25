# Changelog

## 5.0.0 — 2026-10-25

試験の環境のログイン画面を本番と同じ画面に戻した。利用者を選んでログインするのは開発者ホームだけになる。SDK の export と RPC の wire は変えていない。

### Breaking changes

- 試験の環境のログイン画面 (`buildAuthLoginUrl` の URL) は、利用者の一覧の代わりに本番と同じログイン画面を出す。一覧で利用者を押してログインしていた試験は落ちる
- ログイン画面の一覧が送っていた `POST /testing/v1/account-picker` は 404 を返す

### 移行

- ログイン画面で利用者を選んでいた consumer は、`buildDevHomeUrl` の開発者ホームで選ぶ
- 未ログインの利用者を `buildAuthLoginUrl` へ移す consumer の画面から入っても、試験の環境のログイン画面では利用者を選べない。試験の環境で画面から利用者を選ぶ時は、`buildDevHomeUrl` の URL を開く

## 4.0.0 — 2026-10-24

試験の環境の auth ホストを、本番と同じ安全の設定で動かす。session cookie に `Secure` を付け、service key の無い RPC を通さず、ログインの試行回数の上限を本番と同じにした。SDK の cookie の helper は `__Secure-` の付いた session cookie だけを読む。SDK の export と wire は変えていない。

### Breaking changes

- 試験の環境の compose の断片は `TAIMEI_AUTH_SERVICE_KEY` を求める。無いと compose が起動しない
- session cookie に `Secure` が付き、名前が `__Secure-better-auth.session_token` になる。browser は http の `Secure` cookie を `localhost` と `*.localhost` の host の時だけ受け取るので、`TAIMEI_AUTH_URL` が http でほかの host (例 `*.local`) だとログインできない
- `getSessionToken`・`hasAuthCookie`・`extractSessionTokenFromCookieHeader` は `__Secure-better-auth.session_token` だけを読み、`__Secure-` の無い `better-auth.session_token` を読まない。`__Secure-` の無い名前の cookie は、`Secure` でない origin や同じ domain の別の subdomain からも書けるので、そこに置かれた他人の token を session として読まないためである。`buildSessionCookieHeader` も `__Secure-` の付いた名前だけを書く
- redirect 先は、試験の環境では `localhost` と、auth ホストが決めた host 名だけを許す (http と https の両方)。任意の `*.localhost` は許さず、`*.local` の host も許さない

### 移行

- `taimei-auth.env` に `TAIMEI_AUTH_SERVICE_KEY` を足す。値は consumer が RPC に送る service key と同じにする
- session cookie の header を自分で組む試験は、`buildSessionCookieHeader` で組む
- `TAIMEI_AUTH_URL`・`TAIMEI_AUTH_HOSTNAME`・`TAIMEI_AUTH_COOKIE_DOMAIN`・`TAIMEI_AUTH_CONSUMER_ORIGINS` の host を `*.localhost` にする。redirect 先にする consumer の host は、auth ホストが決めた host 名か `localhost` にする。browser が container の中で動く時は、Chromium の起動引数に `--host-resolver-rules` を足す (README の「起動」)
- ログインの試行回数の上限が本番と同じ (60 秒に、同じ IP から 5 通、同じ email に 3 通) になる。試験の環境の auth ホストは client の IP を区別しないので、IP ごとの上限 (Magic Link の送信と MFA チャレンジ) は、すべての browser で 1 つの枠を分け合う。試験の利用者は、ログイン画面から Magic Link を送らず、`createSignedInUser` の `loginUrl` でログインする

## 3.9.0 — 2026-10-24

試験の環境で、開発者ホームとログイン画面の一覧の見た目を変え、候補に出す利用者を、開発用アカウントとその browser でログインした利用者に絞った。SDK の export と wire は変えていない。

### Features

- 開発者ホームとログイン画面の一覧を、auth ホストのほかの画面と同じ部品と見た目 (shadcn/ui、Inter) で、browser の JavaScript で描く。上端に、本番以外の環境の画面であることを示す帯を出す
- 開発者ホームはログイン中の利用者の名前、メール、所属する事業所と role、現在の事業所を出す
- 開発者ホームとログイン画面の一覧に出す候補は、開発用アカウントと、その browser でログインしたことがある利用者だけである。ほかの browser でログインした利用者は出さず、その利用者を選ぶ POST は 404 になる。ログイン中に開発者ホームを開くと、その利用者をその browser の候補に足す
- 利用者はメールの一覧から押して選び、押すとすぐにその利用者でログインし直す。ログイン中の利用者の行は押せず、「ログイン中」と出す。候補が 8 人を超えると、一覧の上に絞り込み欄を出し、名前かメールの一部を入れると一致する利用者だけが一覧に残る
- 開発者ホームは「アプリケーションに戻る」(または「アカウント管理画面を開く」) を一覧より前に出す。ログイン画面は「新規登録」を一覧より前に出す
- ログイン中は、ログイン中の利用者の欄の「ログアウト」のボタンでログアウトできる
- 選んだ直後とログアウトした直後は、「〜でログインしました」「ログアウトしました」を出す
- `returnTo` を付けた URL (`buildDevHomeUrl`) で開いた時は戻り先の URL と「アプリケーションに戻る」を、付けない時は「アカウント管理画面を開く」を出す

### 移行

- 試験 API の `createSignedInUser` で作った利用者は、その browser で `loginUrl` を開いてから開発者ホームを開くまで、ログイン画面の一覧と開発者ホームの候補に出ない。画面で選んでログインしていた試験は、`loginUrl` を開いてログインする
- 2 つの画面は JavaScript を切った browser では何も出さず、HTTP で取った HTML にも一覧は入っていない。HTML を取って中を読んでいた試験は、browser で開いて操作する
- 開発者ホームとログイン画面の一覧の markup は SDK の契約に含めない。画面を操作する試験は「ログインする利用者を選ぶ」のような見出しと role で要素を探す

### Breaking changes

なし。

## 3.8.1 — 2026-10-23

試験の環境で、ログイン画面の一覧、開発者ホームの form、試験 API が auth ホスト以外の site から送られた POST を受け付けていたのを止めた。SDK の export と wire は変えていない。

### Bug fixes

- ログイン画面の一覧と開発者ホームで利用者を選ぶ POST と、開発者ホームのログアウトの POST は、Origin が auth ホスト (`TAIMEI_AUTH_URL` の origin) でない時と Origin header が無い時に 403 を返す。これまでは、試験の環境の auth ホストを動かしたまま別の site を開くと、その site が自動で送る form で、開発者の browser が別の利用者にログインし直したりログアウトしたりした
- 試験 API (`createTestingClient` が呼ぶ `/testing/v1/signed-in-users` と `/testing/v1/current-company`) は、`Content-Type` が `application/json` でない POST に 400 を返す。これまでは、別の site が `text/plain` の form で JSON を組んで送ると、試験の利用者を作ったり現在の事業所を切り替えたりできた

### 移行

browser での操作は変わらない。試験の code がこれらの form を browser を通さずに POST している時は、`Origin: <TAIMEI_AUTH_URL の origin>` を付ける。`createTestingClient` を使わずに試験 API を呼んでいる時は、`Content-Type: application/json` を付ける。

### Breaking changes

なし。

## 3.8.0 — 2026-10-23

試験の環境に開発者ホームと、その URL を組む `buildDevHomeUrl` を足した。wire は変えていない。

### Features

- `@taimei-code/auth-client/testing` に `buildDevHomeUrl({ authBaseUrl, service, returnTo })` を足した。試験の環境の開発者ホーム (`/dev-home`) の URL を、`service_name` と `redirect_url` を付けて組む
- 試験の環境の auth ホストに開発者ホームを足した。ログイン中の利用者と利用者の一覧を出し、ログインしたまま別の利用者に切り替えて `returnTo` へ移る。ログアウトもできる。ログイン画面 (`buildAuthLoginUrl` の URL) の一覧は今までどおり
- 開発者ホームは、ログイン画面と同じく、`service` に許可されない `returnTo` を受けるとエラー画面へ移す

### 移行

なし。

### Breaking changes

なし。

## 3.7.1 — 2026-10-22

試験の環境の起動で、所属の無い利用者に事業所を作っていたのを止めた。migrate が失敗した時に原因を出すようにした。SDK の export と wire は変えていない。

### Bug fixes

- 試験の環境を起動するたびに、所属の無い利用者 (`companies: []` で作った利用者など) へ事業所を作り、その利用者を OWNER にしていたのを止めた。3.7.0 では、所属の無い利用者が `docker compose down` → `up` の後に事業所を 1 つ持っていた
- 試験の環境の起動で auth の DB の migrate が失敗した時、原因 (接続の失敗、Postgres の error code など) を auth ホストの log に出す。これまでは `exited with code 1` だけだった

### 移行

- 3.7.0 の volume には、起動のたびに作られた事業所が残っている。所属の無い利用者を試す試験があれば、`docker compose down -v` で volume を消してから起動する

### Breaking changes

なし。

## 3.7.0 — 2026-10-21

試験の環境で、ログイン画面から開発用アカウントを選ぶだけでログインできるようにした。試験の環境の auth の DB と session を、container を作り直しても残るようにした。SDK の export と wire は変えていない。

### Features

- 試験の環境のログイン画面に、開発用アカウントと試験の環境で作った利用者の一覧を出す。選ぶとその利用者でログインし、`returnTo` へ移る。開発用アカウントは OWNER・ADMIN・MEMBER と 2 つの事業所をそろえ、何度起動しても利用者と事業所の id が変わらない。開発用アカウントの一覧は README の「開発用アカウントでログインする」にある
- compose の断片の DB を volume に置いた。利用者・事業所・所属と session は `docker compose down` の後の `up` でも残り、`docker compose down -v` で消える。これまでは DB が container と一緒に消えていた

### 移行

- 試験の環境を起動するたびに auth の DB を空にしていた (自分の DB を毎回作り直すなど) 場合は、`docker compose down` を `docker compose down -v` に替える。替えないと、auth の DB だけが前回の利用者と事業所を持ったまま起動する
- ログインのために Magic Link を auth ホストのログから拾っていたら、ログイン画面で開発用アカウントを選ぶ形に替える

### Breaking changes

なし。

## 3.6.0 — 2026-10-19

consumer が taimei-auth の内部を知らずに、試験の環境 (e2e と手元の確認) で taimei-auth を動かし、試験の利用者でログインできるようにした。新規登録の直後かを判定する関数を足した。追加だけで、既存の export と wire は変えていない。

### Features

- compose の断片 `testing/compose.yml` を package に入れた。consumer の compose から `include:` すると、試験の環境の taimei-auth と DB が起動する。image はこの版と同じ版で出し、digest で固定している。設定の一覧は README の「試験の環境」にある
- `@taimei-code/auth-client/testing` を足した
  - `createTestingClient(authBaseUrl)` の `createSignedInUser(request)`: 利用者と事業所と所属を作り、一度だけ使えるログイン URL を返す
  - `createTestingClient(authBaseUrl)` の `setCurrentCompany({ userId, companyId })`: 試験の利用者の現在の事業所を切り替える
  - `TESTING_PATH` (`"/testing/v1"`) と、型 `SignedInUserRequest`・`SignedInUser`・`SetCurrentCompanyRequest`
- `isJustSignedUp(sessionData, now?)` を足した。user を作ってから Magic Link の有効期限の内側なら `true` を返す

### 移行

- 試験の環境で、taimei-auth の DB の表への直接の書き込み、Magic Link の token の読み取り、taimei-auth の起動の command と内部の環境変数を使っていたら、README の「試験の環境」の compose の断片と `createTestingClient` に置き換える
- 新規登録の直後かを `user.createdAt` と `MAGIC_LINK_EXPIRES_IN_SECONDS` で自分で比べていたら、`isJustSignedUp` に置き換える

### Breaking changes

なし。

## 3.5.1 — 2026-10-16

README を、consumer の repo で `node_modules` の中から読んで組み込みと版上げができる内容に書き直した。package に `CHANGELOG.md` を含めた。コードと wire は変えていない。

### Docs

- README から特定の framework を前提にした例と、0.4.0 からの移行の節を消した。組み立ての例は `@connectrpc/connect-web` と `Request` だけで書く
- README に、導入 (registry と peerDependencies)、service key が local 以外のすべての RPC で必須なこと、RPC の失敗が `reason: Result.UNSPECIFIED` になること、自分で書かずに SDK の export を使う値の一覧、`checkMemberships`・`findUserByEmail` の用途を足した
- `package.json` の `files` に `CHANGELOG.md` を足した。版上げの時に、`node_modules/@taimei-code/auth-client/CHANGELOG.md` で移行の手順を読める

### Breaking changes

なし。

## 3.5.0 — 2026-10-16

taimei-auth の決めごと (画面の URL、Magic Link の有効期限、RPC の path、事業所 id の形) を SDK から出す。taimei-auth が変えた時に、SDK の版上げで consumer に届く。追加だけで、wire 互換は保つ (proto は変えていない)。

### Features

- 画面の URL を組む関数を追加した。どれも `buildAuthLoginUrl` と同じく options の object を受け、`authBaseUrl` の末尾の `/` の有無に左右されない
  - `buildAuthErrorUrl({ authBaseUrl, reason })`: エラー画面 (`/auth/error?reason=`)
  - `buildCompanySignupUrl({ authBaseUrl, service, returnTo })`: 事業所作成画面 (`/auth/signup/company?service_name=&redirect_url=`)
  - `buildMembersUrl({ authBaseUrl, service, returnTo })`: メンバー画面 (`/account/members?service_name=&redirect_url=`)
  - `buildAccountUrl({ authBaseUrl })`: アカウント管理画面 (`/account`)
- `AUTH_ERROR_REASONS` と `AuthErrorReason` を追加した。consumer がエラー画面へ送れる理由は `signin_failed` と `signup_already_completed` の 2 つで、`buildAuthErrorUrl` はこれ以外を型で受けない
- `AUTH_RPC_PATH` (`"/rpc"`) を追加した。transport の `baseUrl` は auth ホストの origin にこれを付ける
- `MAGIC_LINK_EXPIRES_IN_SECONDS` (`300`) を追加した。単位は秒である
- `COMPANY_ID_PATTERN` (`/^cmp_[A-Za-z0-9_-]{24}$/`) を追加した

### Breaking changes

なし。公開 API の追加だけ (additive)。

### 移行

- taimei-auth の画面の URL と値を自分で組んでいた所は、この版の export に置き換える
- `COMPANY_ID_PATTERN` は `cmp_` に続く 24 文字ちょうどの id だけを受ける。これに合わない id を事業所 id として扱っていた所は、この形に合わせる

## 3.4.0 — 2026-10-15

consumer の 1 request で auth ホストに届く RPC を 2 回から 1 回にする。session、user、現在の事業所での role、メンバー一覧を 1 回で返す RPC を足し、guard の `getSession()` と `listMembers()` はその応答を共有する。公開 API は変えず、wire 互換は保つ (`buf breaking` 通過)。

### Features

- proto に `AuthService.GetSession` と、`GetSessionRequest`・`GetSessionOk`・`GetSessionResponse` を追加した。値の約束 (`current_role` と `members` が空になる時、順序) は proto の `GetSessionOk` のコメントにある
- guard の `getSession()` と `listMembers()` は `GetSession` を呼ぶようにした。同じ `cache` を渡すと、両方を呼んでも 1 request で `GetSession` は 1 回である。`cache` を渡さない時は、それぞれが 1 回ずつ呼ぶ
- `listMembers()` は、一覧の事業所を `SessionData.companyId` と比べなくなった。session と一覧を 1 回の応答で受けるので、2 回の呼び出しの間に事業所が切り替わることが起きない。このため、本人が現在の事業所から除名された直後 (`SessionData.companyId` はあり、`role` は `undefined`) は、3.3.0 の `{ ok: false, reason: UNSPECIFIED }` ではなく、事業所未選択の時と同じ `{ ok: true, data: { companyId: undefined, members: [] } }` を返す
- `GetSession` が Connect の `Unimplemented` (HTTP 404) で失敗した時だけ、`VerifySession` と `ListCurrentCompanyMembers` を順に呼んで答える。`GetSession` を持たない auth ホストへ deploy の失敗や rollback で戻っても、login は止まらない。この経路の `listMembers()` は 3.3.0 と同じく事業所を比べ、違えば `{ ok: false, reason: UNSPECIFIED }` を返す

### Breaking changes

なし。公開 API (`createAuthGuard` の options、`getSession()`・`listMembers()`、`SessionData`・`Member`・`ListMembersResult`) は変えていない。

### 移行

- auth ホストを先に展開してから 3.4.0 に上げる。`GetSession` を持たない auth ホストでも動くが、1 request で失敗する `GetSession` と `VerifySession` と `ListCurrentCompanyMembers` の 3 回を呼ぶ (`getSession()` だけを使う request でも一覧を取る)
- SDK が送る RPC の path (`/rpc/auth.v1.AuthService/VerifySession` など) を固定している consumer の試験は、`/rpc/auth.v1.AuthService/GetSession` を 1 回送る期待に直す

## 3.3.0 — 2026-10-06

consumer が、自分の DB にある事業所と人がまだ taimei-auth で有効かを照合できるよう、service key で呼ぶ RPC を足す。抜けた人と削除された事業所のデータを consumer が消すために使う。追加だけで、wire 互換は保つ。

### Features

- `createAuthClient` の戻り値に `companyService` を追加した。`companyService.checkMemberships({ companyId, userIds })` は `{ companyActive, memberUserIds }` を返す。値の約束 (ACTIVE の判定、渡した人のうち所属する人だけを返すこと、入力の上限) は proto の `CheckMembershipsRequest`・`CheckMembershipsResponse` のコメントにある
- proto に `CompanyService.CheckMemberships` と、`CheckMembershipsRequest`・`CheckMembershipsResponse` を追加した。名前とメールアドレスは返さない

### Breaking changes

なし。公開 API の追加だけ (additive)。

### 移行

- auth ホストを先に展開してから 3.3.0 の `checkMemberships` を呼ぶ。`CompanyService` を持たない auth ホストに呼ぶと、Connect の `Unimplemented` か `NotFound` で失敗する。失敗を「事業所が無い」と扱わない

## 3.2.0 — 2026-10-05

consumer が現在の事業所のメンバー一覧を取れるよう、session token を受ける RPC を足す。consumer は事業所の ID を渡さず、auth ホストがセッションの user の現在の事業所で一覧を決める。追加だけで、wire 互換は保つ (`buf breaking` 通過)。

### Features

- guard に `listMembers()` を追加した。戻り値は `ListMembersResult` (`{ ok: true; data: { companyId?, members } } | { ok: false; reason }`) である。どの事業所の一覧か、空の時の意味、順序の約束は proto の `ListCurrentCompanyMembersOk` のコメントにある
- `listMembers()` は `getSession()` と一覧の RPC を順に呼ぶ。`getSession()` が失敗すればその結果を返し、一覧の RPC は呼ばない。一覧の事業所が `SessionData.companyId` と違えば `{ ok: false, reason: UNSPECIFIED }` を返す。2 回の呼び出しの間に利用者が事業所を切り替えると、別の事業所の一覧が返りうるためである
- `Member` (`userId`・`name`・`email`・`role`) と `ListMembersResult` 型を export した
- proto に `AuthService.ListCurrentCompanyMembers` と、`CompanyMember`・`ListCurrentCompanyMembersRequest`・`ListCurrentCompanyMembersOk`・`ListCurrentCompanyMembersResponse` を追加した
- SDK が知らない role のメンバーは `role` を `undefined` にして返す。consumer は `SessionData.role` と同じく権限なしとして扱う

### Breaking changes

なし。公開 API の追加だけ (additive)。`SessionData` は変えていない。

### 移行

- auth ホストを先に展開してから 3.2.0 に上げる。`ListCurrentCompanyMembers` を持たない auth ホストに 3.2.0 から呼ぶと、`listMembers()` は `{ ok: false, reason: UNSPECIFIED }` を返す

## 3.1.0 — 2026-10-04

consumer が現在の事業所での role で操作を分けられるよう、VerifySession の応答に role を足す。追加の RPC は要らず、`getSession()` 1 回で companyId と role がそろう。proto の field 追加だけで、wire 互換は保つ (`buf breaking` 通過)。

### Features

- `SessionData.role?: Role` (`"OWNER" | "ADMIN" | "MEMBER"`) を追加した。値の約束 (どの事業所の role か、`undefined` の扱い) は proto の `VerifySessionOk.current_role` のコメントにある
- `Role` 型を export した
- proto に `Role` enum と `VerifySessionOk.current_role` を追加した

### Breaking changes

なし。`SessionData` への optional field の追加だけ (additive)。

### 移行

- auth ホストを先に展開してから 3.1.0 に上げる。`current_role` を返さない auth ホストに 3.1.0 から接続すると、`role` は常に `undefined` (権限なし) になる

## 3.0.0 — 2026-10-03

consumer が使っていない RPC を削除する。consumer が本番の経路で呼ぶのは `AuthService.VerifySession` と `UserService.FindUserByEmail` だけだった。削除した RPC を 2.x の client から呼ぶと、auth ホストは 404 を返す。

### Breaking changes

- `AuthService.GetUser` / `AuthService.FindAccountByUserId` / `AuthService.SignOut` / `AuthService.SendMagicLink` と `UserService.FindUserById` の RPC を削除した。`createAuthClient` が返す `authService` と `userService` から、対応する method (`getUser` / `findAccountByUserId` / `signOut` / `sendMagicLink` / `findUserById`) が消える
- 上の RPC だけが使っていた message を削除した: `GetUserRequest` / `GetUserResponse` / `FindAccountByUserIdRequest` / `FindAccountByUserIdResponse` / `Account` / `SignOutRequest` / `SignOutResponse` / `SendMagicLinkRequest` / `SendMagicLinkResponse` / `FindUserByIdRequest` / `FindUserByIdResponse`
- service key で呼べる操作は `VerifySession` (session token の検証) と `FindUserByEmail` (email による user の参照) だけになった。OAuth の token を返す `FindAccountByUserId` も無くなる

### 移行

- `userService.findUserById` を呼んでいるコードを消す。他の削除した method を呼んでいるコードも消す
- sign-out と magic link の送信は、今までどおり共通画面 SPA が better-auth で行う

## 2.0.0 — 2026-10-03

使われていない公開 API を削除する。consumer は削除した API をどれも使っていないので、code の変更は要らない (version を上げるだけでよい)。deprecate を挟まずに削除したのは、consumer に利用が無いことを確認できたため。削除した RPC を 1.x の client から呼ぶと、auth ホストは 404 を返す。

### Breaking changes

- `UserService.UpdateUser` と `UserService.DeleteUser` の RPC を削除した。service key だけで任意の user を書き換え・削除できる API で、呼び手が無かった。名前と画像の変更、退会は共通画面 SPA で本人の session を使って行う
- `buildAuthLogoutUrl` / `BuildAuthLogoutUrlOptions` を削除した (1.2.0 で `@deprecated`)。sign-out は共通画面 SPA の `authClient.signOut()` で行う
- `mapConnectError` と `AuthServiceUnavailable` / `AuthServiceTimeout` / `AuthServiceUnauthorized`、`./errors` subpath を削除した
- `effect` を `dependencies` から外した (上の error class だけが使っていた)

### Internal

- build は `tsconfig.build.json` で test を除いて compile し、build の前に `dist` を消すようにした (今までは削除済みの出力や test の compile 結果が tarball に入りえた)。test の型検査は root の `bun run typecheck` が行う

## 1.2.1 — 2026-09-24

### Documentation

- `SessionData.companyId` のコメントを JSDoc にし、`.d.ts` に出るようにした (1.2.0 では行コメントだったため consumer の型に出ていなかった)

## 1.2.0 — 2026-09-24

振る舞いは変えない。公開 API の deprecation を含むので minor bump。

### Documentation

- `companyId` の約束を proto の `User.default_company_id` のコメントに書いた (生成型の JSDoc にも出る)
- proto の `Session.company_id` のコメントを事実に合わせた (書き込む処理が無く、値は常に空)

### Deprecations

- `buildAuthLogoutUrl` / `BuildAuthLogoutUrlOptions` を `@deprecated` にした。組み立てた `/auth/sign-out` に応答する route は auth ホストに無く (SPA の fallback が 200 を返すだけで session は残る)、sign-out は共通画面 SPA の `authClient.signOut()` で行う。公開 export の削除は breaking なので次の major (v2.0.0) で行う

### Internal

- `createAuthGuard` の応答の変換を `toVerifyResult` に切り出し、cookie の読み取り関数の引数名を `readCookie` にした (外部 API は不変)
- build に使う TypeScript を 5.9.2 から 7.0.2 に上げた

## 1.1.0 — 2026-05-26

事業所 (company) 機能 (PR #55 → #63) を SDK 公開 API に反映。proto field 追加のみで wire 互換は維持 (`buf breaking` 通過)。

### Features

- `SessionData.companyId?: string` を追加。`createAuthGuard(...).getSession()` の戻り値で参照できる (未選択時 `undefined`)
- proto `Session.company_id` / `User.default_company_id` を unlock。`companyId` の source は `session.companyId ?? user.defaultCompanyId`
- magic-link rate limit / session revoke / dual-key 対応 (内部実装、公開 API 変更なし)

### Breaking changes

なし。`SessionData` への optional field 追加のみ (additive)。v1.0.x からの後方互換 minor bump。

proto contract を v1.0 として凍結し、`buf breaking` を CI で機械的に強制する。

### Stable

- proto `auth.v1.*` を v1.0 contract として凍結。以降の wire 互換性違反は CI (`buf breaking --against main`) で必ず block される
- v0.6.0 で導入した `VerifyResult` / `Result` enum / `SessionData.session.kind` / brand 型境界 を契約として確定
- consumer は v1.0.x をピン留めし、minor / patch では breaking が一切起きないことを期待してよい

### Process changes

- 今後 proto に breaking change を導入する場合、SDK の major 版を bump 必須 (例: v2.0.0)
- 並行運用が必要なら `docs/migration-strategy.md` の Dual Read/Write 戦略を参照
- minor / patch 版での proto 変更は backward-compatible なフィールド追加に限る (`buf breaking` が許容するもの)

### Breaking changes

なし (v0.6.0 で proto 形を確定済)。v1.0.0 は v0.6.x からの no-op bump。

## 0.6.0 — 2026-05-17

`user.revision` 整合 / `VerifyResult` oneof / SDK brand 型境界を導入。proto / SDK 型を最終形に揃え、v1.0 凍結前の最後の breaking 境界。

### Breaking changes

- `createAuthGuard(...).getSession()` の戻り型を `SessionData | null` → `VerifyResult` に変更
  - `VerifyResult = { ok: true; data: SessionData } | { ok: false; reason: Result }`
  - consumer は `if (result.ok) { ... } else { ... }` で分岐
- `SessionData.session.kind: "user"` を新規追加 (現状は `"user"` 固定)
- proto `VerifySessionResponse` を `oneof outcome { ok | error }` に変更
- proto `User` に `int32 revision = 8` を追加
- proto `Session` に `string session_kind = 7` を追加
- proto `Result` enum を新規追加 (`OK` / `SESSION_NOT_FOUND` / `SESSION_EXPIRED` / `USER_DELETED` / `USER_LOCKED` / `REVOKED` / `REVISION_OUTDATED`)

### Features

- DB trigger による `user.revision` 自動 ++ (name / email / email_verified / image / account.password の変更で発火)
- `verifySession` で secondaryStorage (Redis) の `user.revision` と DB の最新値を比較し、不一致なら自動 `signOut` + `Result.REVISION_OUTDATED` を返す
- SDK 内部に `ExternalToken` / `InternalSession` brand 型を導入 (raw token を trusted として扱う path を compile-time block)

### 仕様補足

- account INSERT (OAuth 初回 link / credential 初回 sign-up) では `user.revision` は ++ しない。新規 user は `revision = 0` から開始するため不要
- IdP 自身の handler (`auth-entry-redirect.ts` / `avatar-upload.ts` / `login-shortcut.ts` の `isAuthenticated`) は `auth.api.getSession` 直叩きで stale session を許容してよい。revision 整合 check は consumer SDK の VerifySession 経由でのみ強制される
- `Result.UNSPECIFIED` は「token 不在 / RPC throw / outcome 想定外 / ok.value 欠落」の 4 経路の単一 fallback。consumer は再ログインに倒すこと (将来 `RESULT_TRANSPORT_ERROR` の追加を検討)
- `Result.SESSION_EXPIRED` / `USER_LOCKED` / `REVOKED` は現状到達不能。将来 `session.revoked_at` / user lock を実装した時点で活性化する
- proto `reserved 8 to 20` → `9 to 20` の reserved 解除は、0.5.x client が field 7/8 を空で送信する前提のため wire 互換性は保たれる
- 既存 Redis session (本 migration 初回 deploy 前に発行され revision フィールドを持たない) は handler が cache miss として整合判定を skip するため、deploy 瞬間の一斉ログアウト loop は発生しない
- `AUTH_SERVICE_KEY` 未設定 + `APP_ENV === "production"` の組合せでは process が起動拒否 (fail-fast)

### Migration example

```ts
// Before (v0.5.x)
const session = await guard.getSession();
if (!session) redirect("/auth/?...");
console.log(session.user.id);

// After (v0.6.0)
const result = await guard.getSession();
if (!result.ok) {
  if (result.reason === Result.REVISION_OUTDATED) {
    redirect(buildAuthLoginUrl({ /* ... */ hash: "revision_outdated" }));
  } else {
    redirect(buildAuthLoginUrl({ /* ... */ }));
  }
  return;
}
console.log(result.data.user.id);
```

## 0.5.0

- framework agnostic SDK 化 (docs/adr/0007-signin-signup-unified-api.md 系の境界整理)
- @taimei-code/auth-client へ scope rename + GitHub Packages publish
