import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { extractSessionTokenFromCookieHeader } from "@taimei-code/auth-client";
import { Effect } from "effect";
import { buildApp } from "../../app";
import { dbTest } from "../../__tests__/live-runner";
import { createSessionFor } from "../../__tests__/session-helpers";
import { TestDb } from "../../__tests__/test-db";
import type { Session } from "../../auth";
import { authLayer } from "../../membership/__tests__/test-layers";
import { getSessionProgram, listCurrentCompanyMembersProgram } from "../auth-handler";

const P = "get-session-";
const { run, cleanup } = dbTest(P);

const seedCompanyWithThreeMembers = Effect.gen(function* () {
  const db = yield* TestDb;
  const c1 = yield* db.seedCompany("c1");
  const caller = yield* db.seedUser("caller", { lastUsedCompanyId: c1 });
  yield* db.seedMembership(caller.id, c1, "ADMIN");
  for (const suffix of ["m1", "m2"]) {
    const member = yield* db.seedUser(suffix, { lastUsedCompanyId: c1 });
    yield* db.seedMembership(member.id, c1, "MEMBER");
  }
  return caller;
});

describe("GetSession の一覧", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("同じ session で GetSession と ListCurrentCompanyMembers を呼ぶと、members が同じ列になる", () =>
    run(
      Effect.gen(function* () {
        const caller = yield* seedCompanyWithThreeMembers;
        const signedIn = authLayer(
          () =>
            ({
              user: { id: caller.id },
              session: { id: `${P}s`, expiresAt: new Date("2030-01-01") },
            }) as unknown as Session,
        );

        const got = yield* getSessionProgram({ sessionToken: "db" }).pipe(Effect.provide(signedIn));
        const listed = yield* listCurrentCompanyMembersProgram({ sessionToken: "db" }).pipe(
          Effect.provide(signedIn),
        );
        if (got.outcome.case !== "ok" || listed.outcome.case !== "ok") throw new Error("not ok");

        expect(got.outcome.value.members).toHaveLength(3);
        expect(got.outcome.value.members).toEqual(listed.outcome.value.members);
      }),
    ));
});

describe("AuthService の HTTP の入口", () => {
  const SERVICE_KEY = "get-session-test-key";
  const app = buildApp({ mountStatic: () => {} });
  const originalEnv = { ...process.env };
  const post = (method: string, sessionToken: string, headers: Record<string, string>) =>
    Effect.promise(async () =>
      app.request(`http://localhost/rpc/auth.v1.AuthService/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ sessionToken }),
      }),
    );

  beforeEach(async () => {
    process.env.AUTH_SERVICE_KEY = SERVICE_KEY;
    await cleanup();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });
  afterAll(cleanup);

  test("service key が無ければ GetSession は 401", () =>
    run(
      Effect.gen(function* () {
        const res = yield* post("GetSession", `${P}missing`, {});
        expect([res.status, yield* Effect.promise(() => res.text())]).toEqual([
          401,
          '{"_tag":"ServiceKeyRejected"}',
        ]);
      }),
    ));

  for (const method of ["GetSession", "VerifySession", "ListCurrentCompanyMembers"]) {
    test(`service key と有効な session cookie の値を送ると、${method} は 200 と ok を返す`, () =>
      run(
        Effect.gen(function* () {
          const caller = yield* seedCompanyWithThreeMembers;
          const { headers } = yield* createSessionFor(caller.id);

          const res = yield* post(
            method,
            extractSessionTokenFromCookieHeader(headers.get("cookie") ?? "") ?? "",
            {
              "x-service-key": SERVICE_KEY,
            },
          );

          expect([
            res.status,
            yield* Effect.promise(async () => Object.keys(await res.json())),
          ]).toEqual([200, ["ok"]]);
        }),
      ));
  }
});
