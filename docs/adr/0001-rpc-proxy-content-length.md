# ADR-0001: ConnectRPC は Hono 経由で Content-Length 付き再送する

## Status

[ADR-0011](./0011-cloudflare-workers-migration.md) により Superseded。RPC を `node:http` の proxy から
fetch ハンドラでの直接配信 (`createConnectRouter` + `createFetchHandler`) に変えたため、この ADR が定めた
content-length の再送 (`proxy-helpers.ts`) は不要になり削除した。

## Context

**auth ホスト** (CONTEXT.md) は Bun runtime 上の Hono server を主体とし、`/rpc/*` だけを ConnectRPC で扱う。`@connectrpc/connect-node` の `connectNodeAdapter` は Node.js の `http.Server` を前提に書かれており、Bun 標準の Web API (`Request` / `Response` ベース) とは直接つなげない。それでも Hono と ConnectRPC を 1 つのポートで共存させたい。

## Decision

ConnectRPC は内部ポート (`RPC_INTERNAL_PORT`、既定 3101) で Node.js の `http.createServer` として 127.0.0.1 に bind し、Hono (`/rpc/*`) からそこへ HTTP プロキシする。プロキシ層 (`src/proxy-helpers.ts` と `src/index.ts`) では次の 2 点を必ず行う。

1. リクエストボディを `await c.req.raw.arrayBuffer()` でいったん最後まで読み出す
2. 転送するヘッダから `transfer-encoding` を削除し、`content-length` に `arrayBuffer.byteLength` を明示する

## Why

`connectNodeAdapter` は `Content-Length` 付きのリクエストを期待し、chunked encoding を受けると 400 を返す。Bun から転送される `Headers` には元リクエストの `transfer-encoding: chunked` が残っており、これを `content-length` と併存させることは HTTP 仕様にも反するため、`transfer-encoding` を消して `content-length` に統一する。

## Consequences

- メモリ: 大きな RPC body (avatar のバイナリなど) はいったん全部読む。現状 5MB 上限の avatar も `/api/account/avatar/upload-token` (RPC 外) を経由するため `/rpc/*` には流れない。`/rpc/*` で大きなボディを扱う要件が出たらこの ADR を再検討する。
- サービス間認証 (`X-Service-Key`) は転送前の Hono middleware で完了させる。内部ポートは loopback に bind しているため外部からは到達できない。
- 内部ポートは `127.0.0.1` に固定する。0.0.0.0 にすると loopback 越えのアクセスを許してしまうため、誤らないこと。
