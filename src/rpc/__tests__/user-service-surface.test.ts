import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { buildApp } from "../../app";

const P = "user-rpc-";
const { run, cleanup } = dbTest(P);
const SERVICE_KEY = "user-rpc-test-key";
const app = buildApp({ mountStatic: () => {} });
const originalEnv = { ...process.env };

const callRpc = (path: string, request: unknown) =>
  Effect.promise(async () => {
    const res = await app.request(`http://localhost/rpc/auth.v1.${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": SERVICE_KEY },
      body: JSON.stringify(request),
    });
    const body = res.status === 200 ? ((await res.json()) as { user?: { id: string } }) : undefined;
    return { status: res.status, body };
  });

describe("service key で呼べる UserService は FindUserByEmail だけで、削除した RPC は 404 になる", () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_KEY = SERVICE_KEY;
    return cleanup();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });
  afterAll(cleanup);

  test("FindUserByEmail は存在する email の user を返す", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("found"));

        const res = yield* callRpc("UserService/FindUserByEmail", { email: user.email });

        expect([res.status, res.body?.user?.id]).toEqual([200, user.id]);
      }),
    ));

  test("FindUserByEmail は存在しない email に user を返さない", () =>
    run(
      Effect.gen(function* () {
        const res = yield* callRpc("UserService/FindUserByEmail", {
          email: `${P}missing@example.com`,
        });

        expect(res).toEqual({ status: 200, body: {} });
      }),
    ));

  test.each([
    "AuthService/GetUser",
    "AuthService/FindAccountByUserId",
    "AuthService/SignOut",
    "AuthService/SendMagicLink",
    "UserService/FindUserById",
  ])("%s は存在しない RPC として 404 になる", (path) =>
    run(
      Effect.gen(function* () {
        const res = yield* callRpc(path, {});

        expect(res.status).toBe(404);
      }),
    ));

  test.each([
    "UpdateUser",
    "DeleteUser",
  ])("%s は存在しない RPC として 404 になり、所属の無い user も変わらず残る", (method) =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser(method);
        const before = yield* db.readUser(user.id);

        const res = yield* callRpc(`UserService/${method}`, { userId: user.id, name: "renamed" });

        expect(res.status).toBe(404);
        expect(yield* db.readUser(user.id)).toEqual(before);
      }),
    ));
});
