import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { buildApp } from "../../app";

const P = "company-rpc-";
const { run, cleanup } = dbTest(P);
const SERVICE_KEY = "company-rpc-test-key";
const app = buildApp({ mountStatic: () => {} });
const originalEnv = { ...process.env };

const checkMemberships = (
  request: { companyId: string; userIds: string[] },
  headers: Record<string, string> = { "x-service-key": SERVICE_KEY },
) =>
  Effect.promise(async () => {
    const res = await app.request("http://localhost/rpc/auth.v1.CompanyService/CheckMemberships", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(request),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  });

const ids = (count: number) => Array.from({ length: count }, (_, i) => `${i}`.padStart(8, "u"));

describe("CompanyService.CheckMemberships は service key で呼び、入力の大きさを検査する", () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_KEY = SERVICE_KEY;
    return cleanup();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });
  afterAll(cleanup);

  test("service key 付きで呼ぶと、ACTIVE な事業所に答える", () =>
    run(
      Effect.gen(function* () {
        const co = yield* TestDb.use((db) => db.seedCompany("surface"));

        const res = yield* checkMemberships({ companyId: co, userIds: [] });

        expect(res).toEqual({ status: 200, body: { companyActive: true } });
      }),
    ));

  test("user_ids は 1000 件まで受け、1001 件を invalid_argument で拒否する", () =>
    run(
      Effect.gen(function* () {
        const co = yield* TestDb.use((db) => db.seedCompany("limit"));

        const atLimit = yield* checkMemberships({ companyId: co, userIds: ids(1000) });
        const overLimit = yield* checkMemberships({ companyId: co, userIds: ids(1001) });

        expect([atLimit.status, overLimit.status, overLimit.body.code]).toEqual([
          200,
          400,
          "invalid_argument",
        ]);
      }),
    ));

  test.each([
    ["company_id", (co: string, value: string) => ({ companyId: value, userIds: [] }), "c"],
    [
      "user_ids の各要素",
      (co: string, value: string) => ({ companyId: co, userIds: [value] }),
      "u",
    ],
  ] as const)("%s は 1〜64 文字だけを受ける", (_, request, char) =>
    run(
      Effect.gen(function* () {
        const co = yield* TestDb.use((db) => db.seedCompany(`length-${char}`));
        const statuses = [];
        for (const value of ["", char.repeat(65), char.repeat(64)]) {
          statuses.push((yield* checkMemberships(request(co, value))).status);
        }

        expect(statuses).toEqual([400, 400, 200]);
      }),
    ));

  test("service key が無いと拒否する", () =>
    run(
      Effect.gen(function* () {
        const co = yield* TestDb.use((db) => db.seedCompany("no-key"));

        const res = yield* checkMemberships({ companyId: co, userIds: [] }, {});

        expect(res.status).toBe(401);
      }),
    ));
});
