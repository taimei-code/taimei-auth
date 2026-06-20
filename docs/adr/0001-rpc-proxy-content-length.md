# ADR-0001: ConnectRPC は Hono 経由で Content-Length 付き再送する

## Status

Superseded by [ADR-0011](./0011-cloudflare-workers-migration.md) — RPC を `node:http` proxy から
fetch ハンドラ直配信 (`createConnectRouter` + `createFetchHandler`) に変えたため、本 ADR の
content-length 再送 (`proxy-helpers.ts`) は不要になり削除した。

## Context

**auth ホスト** (CONTEXT.md) は Bun runtime 上の Hono server を主としつつ、`/rpc/*` のみ ConnectRPC を扱う。`@connectrpc/connect-node` の `connectNodeAdapter` は Node.js の `http.Server` 前提で書かれており、Bun 標準の Web API (`Request`/`Response` ベース) と直接結線できない。Hono と ConnectRPC を 1 ポートで共存させたい。

## Decision

ConnectRPC は内部 port (`RPC_INTERNAL_PORT`, default 3101) で Node.js `http.createServer` として 127.0.0.1 に bind し、Hono (`/rpc/*`) からそこへ HTTP プロキシする。プロキシ層 (`src/proxy-helpers.ts` + `src/index.ts`) で次の 2 点を必ず行う:

1. リクエストボディは `await c.req.raw.arrayBuffer()` で一旦完全に読み出す
2. forward 時の Headers から `transfer-encoding` を削除し、`content-length` を `arrayBuffer.byteLength` で明示する

## Why

`connectNodeAdapter` は `Content-Length` 付きリクエストを期待する (chunked encoding を受けると 400 を返す)。Bun から forward される `Headers` には元リクエストの `transfer-encoding: chunked` が残っており、`content-length` と併存させるのは HTTP 仕様違反でもあるため、`transfer-encoding` を消して `content-length` に統一する。

## Consequences

- メモリ: 大きな RPC body (avatar binary 等) は一旦全部読む。現状 5MB 上限の avatar も `/api/account/avatar/upload-token` (RPC 外) を経由するため `/rpc/*` に流れない。`/rpc/*` で大ボディを扱う要件が出たら本 ADR を再検討する。
- サービス間認証 (`X-Service-Key`) は forward 前の Hono middleware で完了させる: 内部 port は loopback bind で外部不可達。
- 内部 port は `127.0.0.1` 固定。0.0.0.0 にすると loopback 越えのアクセスを許してしまうため誤らないこと。
