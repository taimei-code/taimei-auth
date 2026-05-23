import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../index";
import { connectRedis } from "../redis";

beforeAll(async () => {
  await connectRedis();
});

// ADR-008 retrospective で発覚した 2 件の隠れバグを再発防止する integration test。
//
// 1. Hono v4 wildcard 構文ミス (#52): `/api/auth/**` は `* が 2 つ` と解釈されて
//    `/api/auth/sign-in/magic-link` 等の nested path に match せず Better Auth handler に
//    到達不能だった。`/api/auth/*` (末尾 wildcard が multi-segment catch) に修正。
//    再発検出: 主要 nested path が 404 を返さないことを assert する。
//
// 2. Magic Link rate-limit が local env で過小設定 (#53): #52 fix で route が initial に
//    effective になり、5/IP/min の rate-limit が e2e の連続発火で 429 を返した。
//    local env では 1000/min に緩和済。
//    再発検出: APP_ENV=development で 10 連続送信が 429 にならないことを assert する。

describe("Hono /api/auth/* route registration (regression for #52)", () => {
  test("GET /api/auth/ok returns 200 (Better Auth health endpoint reachable)", async () => {
    const res = await app.request("http://localhost/api/auth/ok");
    expect(res.status).toBe(200);
  });

  test("POST /api/auth/sign-in/magic-link is registered (not 404)", async () => {
    const res = await app.request("http://localhost/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "regression-test@example.com" }),
    });
    // 200 (送信成功) / 400 (validation) / 429 (rate-limit) いずれも OK、404 のみ NG
    expect(res.status).not.toBe(404);
  });

  test("GET /api/auth/get-session is registered (not 404)", async () => {
    const res = await app.request("http://localhost/api/auth/get-session");
    expect(res.status).not.toBe(404);
  });
});

describe("Magic Link rate-limit local 緩和 (regression for #53)", () => {
  test("APP_ENV=development で 10 連続送信が 429 にならない", async () => {
    // 前提: test 環境では APP_ENV=development (or undefined) で isLocalEnvironment()=true。
    // production 環境で test を回す運用は無いため、env を強制設定しない (env 設定は
    // module top-level で固まっているため、ここで stub しても効かない)。

    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await app.request(
        "http://localhost/api/auth/sign-in/magic-link",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: `regression-rate-${i}@example.com` }),
        },
      );
      statuses.push(res.status);
    }

    // production limit (5) のままだと 6 件目以降が 429 になる。
    // local 緩和 (1000) なら全て non-429。
    const rateLimited = statuses.filter((s) => s === 429);
    expect(rateLimited.length).toBe(0);
  });
});
