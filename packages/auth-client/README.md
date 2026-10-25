# @taimei-code/auth-client

taimei-auth (認証サービス) を consumer の server から使うための SDK。session の確認、現在の事業所のメンバー一覧、taimei-auth の画面の URL、taimei-auth が決める値を提供する。

SDK は framework と runtime に依存しない。transport は consumer が組み立てて渡し、redirect と cookie の読み出しは consumer が行う。

## 導入

GitHub Packages で公開している。`.npmrc` に registry と、`read:packages` を持つ token を設定する。

```ini
@taimei-code:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

peerDependencies の `@bufbuild/protobuf` (^2) と `@connectrpc/connect` (^2) に加えて、transport を 1 つ入れる。fetch で動く `@connectrpc/connect-web` は Node、Cloudflare Workers、Bun、Deno のどれでも使える。

## 組み立て

```ts
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  AUTH_RPC_PATH,
  createAuthClient,
  createAuthGuard,
  createServiceKeyInterceptor,
  extractSessionTokenFromCookieHeader,
} from "@taimei-code/auth-client";

const client = createAuthClient({
  transport: createConnectTransport({
    baseUrl: `${authBaseUrl}${AUTH_RPC_PATH}`,
    interceptors: [createServiceKeyInterceptor(serviceKey)],
  }),
});

export const guardOf = (request: Request) =>
  createAuthGuard({
    client,
    getSessionToken: async () =>
      extractSessionTokenFromCookieHeader(request.headers.get("cookie") ?? ""),
  });
```

- `authBaseUrl` は auth ホストの origin、`serviceKey` は consumer に発行された service key である。
- auth ホストは、local 以外ではすべての RPC に service key を求める。interceptor を付けないと、すべての RPC が拒否され、guard の結果は `reason: Result.UNSPECIFIED` になる。
- `createAuthGuard` は request ごとに作る。`getSessionToken` がその request の cookie を読むためである。
- `cache` (省略可) に `(fn) => fn` の形の関数を渡すと、`getSession()` と `listMembers()` が 1 回の RPC を共有する。省略すると、呼ぶたびに RPC を送る。

## session とメンバー一覧

```ts
import { buildAuthLoginUrl } from "@taimei-code/auth-client";

const session = await guardOf(request).getSession();
if (!session.ok) {
  return Response.redirect(buildAuthLoginUrl({ authBaseUrl, service, returnTo: request.url }), 302);
}
```

- `getSession()` は `{ ok: true, data: SessionData } | { ok: false, reason: Result }` を返す。cookie が無い時は RPC を送らず、`reason: Result.SESSION_NOT_FOUND` を返す。
- `listMembers()` は現在の事業所のメンバー一覧を返す。`getSession()` が失敗する時は同じ `reason` で失敗する。
- RPC の失敗 (通信の失敗、service key の拒否、auth ホストの障害) は例外にならず、`reason: Result.UNSPECIFIED` になる。session が無い・失効した時の `reason` (`SESSION_NOT_FOUND`・`REVOKED` など) と区別して、監視に記録する。
- `SessionData.companyId` が `undefined` の時は事業所が未選択なので、`buildCompanySignupUrl` の画面へ移す。
- `SessionData.role` と `Member.role` が `undefined` の時は、権限なしとして扱う。
- 新規登録の直後かは `isJustSignedUp(session.data)` で判定する。user を作ってから Magic Link の有効期限の内側なら `true` を返す。`user.createdAt` と有効期限を自分で比べない。
- redirect は consumer が行う。SDK は redirect をしない。
- 1 request で auth ホストに送る RPC は `/rpc/auth.v1.AuthService/GetSession` の 1 回である。auth ホストが `GetSession` を持たない (`Unimplemented`) 時だけ、`VerifySession` と `ListCurrentCompanyMembers` を順に送る。

値の約束の詳細は、この package の `dist/types.d.ts` と `dist/gen/auth/v1/auth_pb.d.ts` のコメントにある。

## SDK の export を使い、自分で書かないもの

taimei-auth が変えた時に SDK の版上げで届くよう、次の値を consumer のコードに直接書かない。

| 書かないもの | 使う export |
|---|---|
| session cookie の名前と cookie header の解析 | `extractSessionTokenFromCookieHeader(header)`、`getSessionToken(readCookie)`、`hasAuthCookie(readCookie)` |
| 試験で送る session cookie の header | `buildSessionCookieHeader(token)` |
| RPC の path (`/rpc`) | `AUTH_RPC_PATH` |
| login 画面の URL (`/auth/`) | `buildAuthLoginUrl({ authBaseUrl, service, returnTo, signUpUrl?, hash? })` |
| エラー画面の URL (`/auth/error`) と理由 | `buildAuthErrorUrl({ authBaseUrl, reason })`、`AUTH_ERROR_REASONS` |
| 事業所作成画面の URL | `buildCompanySignupUrl({ authBaseUrl, service, returnTo })` |
| メンバー画面の URL | `buildMembersUrl({ authBaseUrl, service, returnTo })` |
| アカウント管理画面の URL | `buildAccountUrl({ authBaseUrl })` |
| 試験の環境の開発者ホームの URL (`/dev-home`) | `@taimei-code/auth-client/testing` の `buildDevHomeUrl({ authBaseUrl, service, returnTo })` |
| Magic Link の有効期限 (秒) | `MAGIC_LINK_EXPIRES_IN_SECONDS` |
| 新規登録の直後か (`user.createdAt` と Magic Link の有効期限の比較) | `isJustSignedUp(sessionData, now?)` |
| 事業所 id の形 | `COMPANY_ID_PATTERN` |
| role の値 | `Role` 型 (`"OWNER" \| "ADMIN" \| "MEMBER"`) |

`service` は、consumer が taimei-auth に登録した service 名である。URL を組む関数は、`authBaseUrl` の末尾の `/` の有無に左右されない。

## server 間の RPC

`createAuthClient` の戻り値から、session を持たない処理 (batch など) で呼ぶ。

- `companyService.checkMemberships({ companyId, userIds })`: 事業所が ACTIVE か (`companyActive`) と、`userIds` のうち今所属している人 (`memberUserIds`) を返す。consumer の DB に残る、抜けた人や削除された事業所のデータを見つけるために使う。RPC の失敗を「事業所が無い」と扱わない。
- `userService.findUserByEmail({ email })`: メールアドレスで user を引く。いなければ `user` は `undefined` である。

## 試験の環境 (e2e と手元の確認)

taimei-auth を試験の環境で動かす compose の断片と、試験の利用者を作る client を、この package に入れている。断片が参照する image は、この package と同じ版で出し、digest で固定している。taimei-auth を更新する時は、この package の版を上げるだけでよい。taimei-auth の DB の表、Better Auth の endpoint、起動の command、内部の環境変数の名前は知らなくてよい。

### 起動

consumer の compose から、この package の compose の断片を `include:` する。`include:` は Docker Compose v2.20 以降で使える。

```yaml
include:
  - path: ./node_modules/@taimei-code/auth-client/testing/compose.yml
    env_file: ./taimei-auth.env
```

`taimei-auth.env` には次の値を書く。

| 変数 | 値 |
|---|---|
| `TAIMEI_AUTH_URL` | 必須。試験の環境での auth ホストの URL (例 `http://auth.example.localhost:3100`)。session cookie には `Secure` が付くので、http で動かす時の host は `localhost` か `*.localhost` にする (browser は http の `Secure` cookie を、この 2 つの host の時だけ受け取る) |
| `TAIMEI_AUTH_HOSTNAME` | 必須。上の URL の host 名。compose の network で auth ホストに付く名前になる |
| `TAIMEI_AUTH_COOKIE_DOMAIN` | 必須。session cookie の domain (例 `example.localhost`)。localhost で動かす時は空にする |
| `TAIMEI_AUTH_CONSUMER_ORIGINS` | 必須。consumer の origin。複数なら `,` でつなぐ |
| `TAIMEI_AUTH_SECRET` | 必須。試験の環境だけで使う 32 文字以上の値 |
| `TAIMEI_AUTH_SERVICE_KEY` | 必須。consumer が auth ホストの RPC を呼ぶ時に送る service key と同じ値。試験の環境でも service key の無い RPC は通さない |
| `TAIMEI_AUTH_APP_NAME` | 必須。メールなどに出す service の表示名 |
| `TAIMEI_AUTH_PORT` | 任意。auth ホストが container の中で待ち受ける port (既定 3100) |

- auth ホストの service 名は `taimei-auth` である。auth ホストは migrate を終えて `/health` が 200 を返すと healthy になる。consumer の service は `depends_on: { taimei-auth: { condition: service_healthy } }` で待つ。
- 断片は compose の project の `default` network を使う。consumer の service も `default` network に置き、`TAIMEI_AUTH_HOSTNAME` で auth ホストに届くようにする。
- browser が container の中で動く時、Chromium は `*.localhost` を自分の loopback に向けるので、auth ホストに届かない。Chromium の起動引数に、host ごとに `--host-resolver-rules=MAP auth.example.localhost <auth ホストの container の host 名>, MAP <consumer の host> <consumer の container の host 名>` を付ける。1 行の wildcard では宛先を 1 つにしか向けられない
- 断片の image は linux/amd64 だけである。arm64 の host では amd64 のエミュレーションで動く。エミュレーションには Rosetta を使う。Docker Desktop は既定で使わないので、設定の「Use Rosetta for x86_64/amd64 emulation on Apple Silicon」を有効にする。colima は `colima start --vz-rosetta` で起動する。Rosetta を使わないと QEMU で動き、起動と応答が遅くなる。
- 断片の image は private である。pull する前に、この package を入れるのと同じ `read:packages` の token で `docker login ghcr.io` する。
- `include:` は host の `node_modules` を読むので、compose を起動する前に、この package を host に install しておく。
- 断片は auth ホスト専用の DB を起動する。利用者・事業所・所属と session、ログインの試行回数の制限の計数は compose の volume に残り、`docker compose down` の後の `up` でも消えない。消すには `docker compose down -v` を使う。
- 手元の確認で host から auth ホストに届かせる時は、override の file で `taimei-auth` に `ports` を足す。host で待ち受ける address は `127.0.0.1:3100:3100` のように loopback に限る。

### 開発用アカウントでログインする

試験の環境で利用者を選んでログインする時は、開発者ホーム (`buildDevHomeUrl` の URL) を開く。ログイン画面 (`buildAuthLoginUrl` の URL) は本番と同じ画面を出し、そこでは利用者を選べない。開発者ホームの一覧には次の開発用アカウントと、その browser の一覧に足された利用者が出る。利用者はログイン中にその browser で開発者ホームを開いた時に足される。試験 API で作った利用者は、その browser で `loginUrl` を開いてから開発者ホームを開く。ほかの browser でログインした利用者は出ず、選べない。

| 利用者 | 事業所 1 | 事業所 2 |
|---|---|---|
| `dev-owner@example.com` | OWNER | OWNER |
| `dev-admin@example.com` | ADMIN | MEMBER |
| `dev-member@example.com` | MEMBER | — |

- auth ホストは起動するたびに、開発用アカウントのうち無いものだけを足す。利用者と事業所の id は何度起動しても変わらない。現在の事業所は事業所 1 である
- 開発者ホームは試験用の image の中にだけあり、本番の auth ホストには無い

```ts
import { buildDevHomeUrl } from "@taimei-code/auth-client/testing";

const devHomeUrl = buildDevHomeUrl({
  authBaseUrl: "http://auth.example.local:3100",
  service: "example-service",
  returnTo: "http://app.example.local:3001/current-page",
});
```

| 画面 | ログインしていない時 | ログイン中 |
|---|---|---|
| ログイン画面 (`buildAuthLoginUrl`) | 本番と同じ画面を出す | 本番と同じく `returnTo` へ移る。ACTIVE な事業所に 1 つも所属していない利用者は、`returnTo` の代わりに事業所の新規登録の画面 (`buildCompanySignupUrl` の URL) へ移る |
| 開発者ホーム (`buildDevHomeUrl`) | 一覧を出し、選ぶと `returnTo` へ移る | ログイン中の利用者の名前、メール、所属する事業所と role を出し、一覧で別の利用者を押すと切り替えて `returnTo` へ移る。候補が 8 人を超えると、一覧の上の欄に名前かメールの一部を入れて一覧を絞れる。「ログアウト」のボタンでログアウトすると開発者ホームに戻る |

- 開発者ホームは、ログイン画面と同じく、`service` に許可されない `returnTo` を受けるとエラー画面へ移す。`returnTo` の origin は `TAIMEI_AUTH_CONSUMER_ORIGINS` に含める
- 開発者ホームの「アプリケーションに戻る」は、ログインし直さずに `returnTo` へ戻る
- 開発者ホームの form の POST は、Origin が `TAIMEI_AUTH_URL` の origin の時だけ受け付け、それ以外は 403 になる。browser では開発者ホームを `TAIMEI_AUTH_URL` と同じ host で開く。browser を通さずに POST する時は `Origin: <TAIMEI_AUTH_URL の origin>` を付ける

### 試験の利用者

```ts
import { createTestingClient } from "@taimei-code/auth-client/testing";

const testing = createTestingClient("http://auth.example.local:3100");
const signedIn = await testing.createSignedInUser({
  companies: [{ role: "OWNER" }, { role: "MEMBER" }],
  returnTo: "http://app.example.local:3001/after-sign-in",
});
await page.goto(signedIn.loginUrl);
await testing.setCurrentCompany({ userId: signedIn.userId, companyId: signedIn.companyIds[1] });
```

- `createSignedInUser` は、利用者と、`companies` の順に事業所と所属を作る。最初の事業所が現在の事業所になる。`OWNER` 以外の role の事業所には、別の利用者が `OWNER` として入る。
- 戻り値の `loginUrl` を browser で開くと、session cookie が付いて `returnTo` へ移る。一度だけ使える。
- `returnTo` の origin は `TAIMEI_AUTH_URL` か `TAIMEI_AUTH_CONSUMER_ORIGINS` に含める。含まないと 400 になる。
- `returnTo` に招待の URL を渡さない。招待のメールが送られてログイン URL を返せず、500 になる。
- `createTestingClient` を使わずに試験 API を呼ぶ時は `Content-Type: application/json` を付ける。付けないと 400 になる。
- `setCurrentCompany` は現在の事業所を切り替える。所属しない事業所を渡すと 400、無い利用者を渡すと 404 になる。
- 失敗した時、client は status を message に含めた `Error` を投げる。
- 試験 API は、試験用の image の中でだけ動く。本番の auth ホストには無い。誰でもログインした利用者を作れるので、試験の環境を外から届く場所で動かさない。

## 版上げ

この package の `CHANGELOG.md` に、版ごとの変更と移行の手順がある。版を上げる時は、今の版から上げる先の版までの「Breaking changes」と「移行」を読む。
