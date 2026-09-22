# @taimei-code/auth-client

taimei-auth 認証サービス (IdP) のクライアント SDK。

**設計方針 (taimei-auth repo の `packages/auth-client/CLAUDE.md` ルール 7 / PR #41)**: SDK は consumer の framework に依存しない。`@connectrpc/connect` で抽象化された Transport / Interceptor だけを受け取り、`next/*`、`react`、`@connectrpc/connect-node` などの framework や runtime に固有の module を import しない。Node runtime、Edge runtime、Cloudflare Workers、Bun fetch、Deno のどれからでも利用できる。

---

## 1. Quickstart (Next.js)

### transport 構築

```ts
// lib/auth/client.ts
import "server-only";
import { createConnectTransport } from "@connectrpc/connect-node";
import { createAuthClient, createServiceKeyInterceptor } from "@taimei-code/auth-client";

const interceptors = process.env.AUTH_SERVICE_KEY
  ? [createServiceKeyInterceptor(process.env.AUTH_SERVICE_KEY)]
  : [];

const transport = createConnectTransport({
  httpVersion: "1.1", // Vercel Node runtime
  baseUrl: process.env.AUTH_BASE_URL!,
  interceptors,
});

export const authClient = createAuthClient({ transport });
```

### auth guard

```ts
// app/lib/auth-guard.ts
import "server-only";
import { createAuthGuard, getSessionToken } from "@taimei-code/auth-client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authClient } from "@/lib/auth/client";

const guard = createAuthGuard({
  client: authClient,
  cache, // 1 request 内の重複呼び出しをまとめる
  getSessionToken: async () => {
    const cookieStore = await cookies();
    return getSessionToken((name) => cookieStore.get(name)?.value);
  },
});

export const getSession = guard.getSession;

// redirect は consumer が所有する。SDK には持たせない (framework 中立のため)
export const requireSession = async ({ returnTo }: { returnTo: string }) => {
  const session = await getSession();
  if (!session) redirect(`/auth?callbackUrl=${encodeURIComponent(returnTo)}`);
  return session;
};
```

---

## 2. Cookie reader 例

`getSessionToken` / `hasAuthCookie` は `(name: string) => string | undefined` の lambda を受け取る。framework ごとの差は次のように吸収する。

```ts
// Next.js (`next/headers`)
const cookieStore = await cookies();
getSessionToken((name) => cookieStore.get(name)?.value);

// Hono
getSessionToken((name) => getCookie(c, name));

// Express
getSessionToken((name) => req.cookies[name]);

// 生の Request (fetch API)
const cookieHeader = request.headers.get("cookie") ?? "";
// この場合は extractSessionTokenFromCookieHeader(cookieHeader) を直接使う方が簡潔
```

`SESSION_COOKIE_NAMES` (`better-auth.session_token` / `__Secure-better-auth.session_token`) は SDK の内部に閉じる。consumer が cookie 名を知る必要はない。

---

## 3. Transport 選択

| Runtime | 推奨 transport | 備考 |
|---------|----------------|------|
| Node.js / Vercel Node | `@connectrpc/connect-node` | `httpVersion: "1.1"` などを指定する |
| Edge / Cloudflare Workers / Bun fetch / browser | `@connectrpc/connect-web` | `httpVersion` は不要 (fetch ベース) |
| Deno | `@connectrpc/connect-web` | 同上 |

どちらの transport も `Transport` 型を返すため、SDK 側のコード (`createAuthClient({ transport })`) は変更なしで動く。

**Note**: `createServiceKeyInterceptor(serviceKey)` は **app の初期化時に 1 度だけ呼び出して transport に渡す** こと。リクエストごとに呼ぶと closure 生成のオーバーヘッドが加わる。

---

## 4. `requireSession` 自前実装 (Next.js 以外の framework)

SDK は `getSession` だけを提供する (`packages/auth-client/CLAUDE.md` ルール 7)。redirect の制御フロー (副作用) は consumer 側の wrapper で書く。Next.js 版は §1 Quickstart を参照。他の framework での例:

```ts
// Hono
app.use(async (c, next) => {
  const session = await getSession();
  if (!session) return c.redirect(`/auth?callbackUrl=${encodeURIComponent(c.req.url)}`);
  c.set("session", session);
  await next();
});

// Express
function requireSession(req, res, next) {
  getSession().then((session) => {
    if (!session) return res.redirect(`/auth?callbackUrl=${encodeURIComponent(req.originalUrl)}`);
    req.session = session;
    next();
  });
}
```

---

## 5. Migration from 0.4.0

| 依存 | 0.4.0 | 0.5.0 |
|------|-------|-------|
| L1: `React.cache` の暗黙利用 | SDK が `cache` の注入を必須にする | `cache?` を optional にし、Next.js の consumer は `cache` (`React.cache`) を明示的に注入する |
| L2: `redirect` の注入 | `createAuthGuard({ redirect })` | consumer 側の wrapper に移す (SDK の戻り値は `{ getSession }` だけ) |
| L3: `CookieReader` の shape | `{ get(name): { value } }` interface | `(name: string) => string \| undefined` の関数型 |
| L4: `@connectrpc/connect-node` | SDK が `createConnectTransport` を内蔵し、peerDeps にも存在する | consumer が transport を構築して `createAuthClient({ transport })` に渡す。SDK の peerDeps から削除 |
| L5: `/auth?callbackUrl=` のハードコード | SDK の `buildLoginRedirectPath` が組み立てる | consumer 側の wrapper で組み立てる (URL の規約は consumer が所有する) |

主な API の rename:

- `getSessionTokenFromCookieStore(store)` → `getSessionToken(reader)`
- `createAuthClient({ baseUrl, serviceKey })` → `createAuthClient({ transport })` (transport は consumer が組み立て、Service Key は `createServiceKeyInterceptor(key)` を interceptor として transport に注入する)
- `createAuthGuard(...).requireSession` は廃止し、consumer 側の 4 行の wrapper に移す

詳細: taimei-auth repo の `packages/auth-client/CLAUDE.md` ルール 7 / PR #41 を参照。
