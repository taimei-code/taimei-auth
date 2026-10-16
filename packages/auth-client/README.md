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
| Magic Link の有効期限 (秒) | `MAGIC_LINK_EXPIRES_IN_SECONDS` |
| 事業所 id の形 | `COMPANY_ID_PATTERN` |
| role の値 | `Role` 型 (`"OWNER" \| "ADMIN" \| "MEMBER"`) |

`service` は、consumer が taimei-auth に登録した service 名である。URL を組む関数は、`authBaseUrl` の末尾の `/` の有無に左右されない。

## server 間の RPC

`createAuthClient` の戻り値から、session を持たない処理 (batch など) で呼ぶ。

- `companyService.checkMemberships({ companyId, userIds })`: 事業所が ACTIVE か (`companyActive`) と、`userIds` のうち今所属している人 (`memberUserIds`) を返す。consumer の DB に残る、抜けた人や削除された事業所のデータを見つけるために使う。RPC の失敗を「事業所が無い」と扱わない。
- `userService.findUserByEmail({ email })`: メールアドレスで user を引く。いなければ `user` は `undefined` である。

## 版上げ

この package の `CHANGELOG.md` に、版ごとの変更と移行の手順がある。版を上げる時は、今の版から上げる先の版までの「Breaking changes」と「移行」を読む。
