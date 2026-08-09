import { describe, expect, test } from "bun:test";
import { app } from "../index";
import { getRedis } from "../redis";

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
      const res = await app.request("http://localhost/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `regression-rate-${i}@example.com` }),
      });
      statuses.push(res.status);
    }

    // production limit (5) のままだと 6 件目以降が 429 になる。
    // local 緩和 (1000) なら全て non-429。
    const rateLimited = statuses.filter((s) => s === 429);
    expect(rateLimited.length).toBe(0);
  });
});

describe("MFA チャレンジ状態取得の rate limit 登録 (ADR-0013)", () => {
  // GET /api/mfa/challenge は requireActor を通らない未認証経路で、有効なチャレンジ cookie が
  // 付けば 1 リクエストで Redis 3 往復を引く。枠の登録漏れは 404 と違って画面が正常に見えるため、
  // handler でなく組み立て済み app の枠消費を直に見る (429 で見ないのは local 緩和で到達しないため)。
  const windowCount = async (key: string): Promise<number> =>
    Number((await (await getRedis()).get(key)) ?? 0);

  // 窓は TTL (60 秒) で自然に消えるため後始末は置かない。
  const isolatedClientIp = (): string => `203.0.113.${crypto.randomUUID()}`;

  test("状態取得が IP 軸の枠を消費する", async () => {
    const ip = isolatedClientIp();

    const res = await app.request("http://localhost/api/mfa/challenge", {
      headers: { "x-forwarded-for": ip },
    });

    expect(res.status).toBe(200);
    expect(await windowCount(`rate-limit:mfa-challenge-status:ip:${ip}`)).toBe(1);
  });

  test("状態取得は verify の枠を消費しない", async () => {
    // 画面はコード誤入力のたびに状態を取り直す (web/src/pages/MfaChallenge.tsx)。枠を共有すると
    // その再取得が verify の枠を削り、正規ユーザーが打ち直しの途中で 429 に落ちる。
    const ip = isolatedClientIp();

    for (let i = 0; i < 3; i++) {
      await app.request("http://localhost/api/mfa/challenge", {
        headers: { "x-forwarded-for": ip },
      });
    }

    expect(await windowCount(`rate-limit:mfa-challenge-status:ip:${ip}`)).toBe(3);
    expect(await windowCount(`rate-limit:mfa-challenge:ip:${ip}`)).toBe(0);
  });
});

describe("Magic Link の user enumeration 防止 (ADR-0007)", () => {
  test("未登録 email と登録済 email で status と body 形状が一致する", async () => {
    // 「未登録なので送れません」を返すと攻撃者にメールアドレスの登録有無を教えてしまうため、
    // 応答は常に同一でなければならない。rate-limit 窓 (IP 軸) を消費しすぎないよう 2 送信に留める。
    const { db } = await import("@/db/client");
    const { user } = await import("@/db/schema");
    const { like } = await import("drizzle-orm");
    const P = "enum-test-";
    await db.delete(user).where(like(user.id, `${P}%`));
    await db.insert(user).values({
      id: `${P}registered`,
      name: "Enum Registered",
      email: `${P}registered@example.com`,
      emailVerified: true,
    });

    const send = (email: string) =>
      app.request("http://localhost/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

    const registered = await send(`${P}registered@example.com`);
    const unregistered = await send(`${P}unregistered@example.com`);

    expect(registered.status).toBe(unregistered.status);
    const registeredBody = await registered.json();
    const unregisteredBody = await unregistered.json();
    expect(Object.keys(registeredBody as object).sort()).toEqual(
      Object.keys(unregisteredBody as object).sort(),
    );
    expect(registeredBody).toEqual(unregisteredBody);

    await db.delete(user).where(like(user.id, `${P}%`));
  });
});
