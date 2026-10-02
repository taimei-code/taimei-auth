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

const callUserService = (method: string, request: unknown) =>
  Effect.promise(async () => {
    const res = await app.request(`http://localhost/rpc/auth.v1.UserService/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": SERVICE_KEY },
      body: JSON.stringify(request),
    });
    const body = res.status === 200 ? ((await res.json()) as { user?: { id: string } }) : undefined;
    return { status: res.status, body };
  });

describe("UserService は user の参照だけを提供する", () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_KEY = SERVICE_KEY;
    return cleanup();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });
  afterAll(cleanup);

  test("FindUserByEmail と FindUserById は同じ service key で user を返す", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("found"));

        const byEmail = yield* callUserService("FindUserByEmail", { email: user.email });
        const byId = yield* callUserService("FindUserById", { userId: user.id });

        expect([byEmail.status, byEmail.body?.user?.id]).toEqual([200, user.id]);
        expect([byId.status, byId.body?.user?.id]).toEqual([200, user.id]);
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

        const res = yield* callUserService(method, { userId: user.id, name: "renamed" });

        expect(res.status).toBe(404);
        expect(yield* db.readUser(user.id)).toEqual(before);
      }),
    ));
});
