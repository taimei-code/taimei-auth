import { describe, expect, test } from "bun:test";
import { requestApp } from "../handlers/__tests__/helpers";
import { Effect } from "effect";
import { app } from "../index";
import { getMemoryKvStore } from "../ttl-store";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";

const P = "enum-test-";
const { run } = dbTest(P);
const request = (url: string, init?: RequestInit) => requestApp(app, url, init);

// taimei (consumer app) 側の実装中に表面化した 2 件の隠れたバグの再発を防ぐ integration テスト。
//
// 1. Hono v4 の wildcard 構文の誤り (#52)。`/api/auth/**` は `*` が 2 つあるものと解釈されて
//    `/api/auth/sign-in/magic-link` などの入れ子のパスに一致せず、Better Auth の handler に
//    到達できなかった。`/api/auth/*` (末尾の wildcard が複数 segment を受ける) に修正した。
//    再発は、主要な入れ子のパスが 404 を返さないことを assert して検出する。
//
// 2. Magic Link の rate-limit が local 環境で小さすぎた (#53)。#52 の修正で route が初めて
//    有効になり、1 IP あたり毎分 5 回の rate-limit が e2e の連続実行で 429 を返した。
//    local 環境では毎分 1000 回に緩和済み。
//    再発は、APP_ENV=development で 10 回連続送信しても 429 にならないことを assert して検出する。

describe("Hono /api/auth/* route registration (regression for #52)", () => {
  test("GET /api/auth/ok returns 200 (Better Auth health endpoint reachable)", () =>
    run(
      Effect.gen(function* () {
        const res = yield* request("http://localhost/api/auth/ok");
        expect(res.status).toBe(200);
      }),
    ));

  test("POST /api/auth/sign-in/magic-link is registered (not 404)", () =>
    run(
      Effect.gen(function* () {
        const res = yield* request("http://localhost/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "regression-test@example.com" }),
        });
        // 200 (送信成功)、400 (validation)、429 (rate-limit) はいずれも許容し、404 だけを不合格にする
        expect(res.status).not.toBe(404);
      }),
    ));

  test("GET /api/auth/get-session is registered (not 404)", () =>
    run(
      Effect.gen(function* () {
        const res = yield* request("http://localhost/api/auth/get-session");
        expect(res.status).not.toBe(404);
      }),
    ));
});

describe("Magic Link rate-limit local 緩和 (regression for #53)", () => {
  test("APP_ENV=development で 10 連続送信が 429 にならない", () =>
    run(
      Effect.gen(function* () {
        // 前提として、テスト環境では APP_ENV が development または未設定で、isLocalEnvironment() が true になる。
        // production 環境でテストを回す運用は無いため、env を強制的に設定しない (env の設定は
        // module の top-level で確定しているため、ここで stub しても反映されない)。

        const statuses: number[] = [];
        for (let i = 0; i < 10; i++) {
          const res = yield* request("http://localhost/api/auth/sign-in/magic-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: `regression-rate-${i}@example.com` }),
          });
          statuses.push(res.status);
        }

        // production の上限 (5) のままだと 6 件目以降が 429 になる。
        // local の緩和値 (1000) なら、すべて 429 以外になる。
        const rateLimited = statuses.filter((s) => s === 429);
        expect(rateLimited.length).toBe(0);
      }),
    ));
});

describe("MFA チャレンジ状態取得の rate limit 登録 (ADR-0013)", () => {
  // GET /api/mfa/challenge は requireActor を通らない未認証の経路で、有効なチャレンジ cookie が
  // 付いていれば 1 リクエストで TTL store と 3 往復する。枠の登録漏れは 404 と違って画面が正常に見えるため、
  // handler ではなく組み立て済みの app で枠の消費を直接確認する (429 で確認しないのは、local の緩和値では到達しないため)。
  const windowCount = (key: string) => Effect.sync(() => Number(getMemoryKvStore().get(key) ?? 0));

  // 窓は TTL (60 秒) で自然に消えるため、後始末は書かない。IP literal 以外は unknown として扱われて窓を
  // 共有するため (request-context.ts)、下位 2 octet を変えてテスト間の衝突だけを避ける。
  const isolatedClientIp = (): string =>
    `203.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

  test("状態取得が IP 軸の枠を消費する", () =>
    run(
      Effect.gen(function* () {
        const ip = isolatedClientIp();

        const res = yield* request("http://localhost/api/mfa/challenge", {
          headers: { "x-forwarded-for": ip },
        });

        expect(res.status).toBe(200);
        expect(yield* windowCount(`rate-limit:mfa-challenge-status:ip:${ip}`)).toBe(1);
      }),
    ));

  test("状態取得は verify の枠を消費しない", () =>
    run(
      Effect.gen(function* () {
        // 画面はコードを誤入力するたびに状態を取り直す (web/src/mfa/pages/MfaChallenge.tsx)。枠を共有すると
        // その再取得が verify の枠を消費し、正規ユーザーが打ち直しの途中で 429 になる。
        const ip = isolatedClientIp();

        for (let i = 0; i < 3; i++) {
          yield* request("http://localhost/api/mfa/challenge", {
            headers: { "x-forwarded-for": ip },
          });
        }

        expect(yield* windowCount(`rate-limit:mfa-challenge-status:ip:${ip}`)).toBe(3);
        expect(yield* windowCount(`rate-limit:mfa-challenge:ip:${ip}`)).toBe(0);
      }),
    ));
});

describe("Magic Link の user enumeration 防止 (ADR-0007)", () => {
  test("未登録 email と登録済 email で status と body 形状が一致する", () =>
    run(
      Effect.gen(function* () {
        // 「未登録なので送れません」を返すと、攻撃者にメールアドレスの登録有無を教えてしまうため、
        // 応答は常に同一でなければならない。IP ごとの rate-limit 窓を消費しすぎないよう、送信は 2 回に留める。
        const db = yield* TestDb;
        yield* db.cleanup();
        yield* db.seedUser("registered", { name: "Enum Registered" });

        const send = (email: string) =>
          request("http://localhost/api/auth/sign-in/magic-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
          });

        const registered = yield* send(`${P}registered@example.com`);
        const unregistered = yield* send(`${P}unregistered@example.com`);

        expect(registered.status).toBe(unregistered.status);
        const registeredBody = yield* Effect.promise(() => registered.json());
        const unregisteredBody = yield* Effect.promise(() => unregistered.json());
        expect(Object.keys(registeredBody as object).sort()).toEqual(
          Object.keys(unregisteredBody as object).sort(),
        );
        expect(registeredBody).toEqual(unregisteredBody);

        yield* db.cleanup();
      }),
    ));
});
