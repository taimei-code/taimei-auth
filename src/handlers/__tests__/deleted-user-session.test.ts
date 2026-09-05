import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Hono } from "hono";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { buildTestApp, requestApp, responseJson, restoreActor, stubActor } from "./helpers";

// 削除済み user の session で書き込み route を叩いた時の fail-closed 契約を固定する。
// better-auth cookieCache (最大 5 分) は user 行の削除後も session を返し続けるため、
// guard が DB の user 存在で fail-closed しないと membership insert が FK 違反 500 になる
// (事業所削除 → 連動アカウント削除 → 同 browser で signup/company 再送信、の実障害を再現)。
const P = "dus-test-";
const { run, cleanup } = dbTest(P);

const postCompany = (app: Hono) =>
  requestApp(app, "/api/account/companies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `${P}co-first`, org_code: "PERSONAL" }),
  });

describe("削除済み user の session actor", () => {
  beforeEach(cleanup);
  afterEach(restoreActor);
  afterAll(cleanup);

  test("user 行が存在しない actor の事業所作成は 401 (FK 500 にしない)", () =>
    run(
      Effect.gen(function* () {
        stubActor({ id: `${P}u-ghost`, email: `${P}ghost@example.com` });

        const res = yield* postCompany(buildTestApp());

        expect(res.status).toBe(401);
        expect(yield* responseJson(res)).toEqual({ error: "unauthorized" });
      }),
    ));

  test("user 行が存在する actor の事業所作成は従来どおり成功する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const actor = yield* db.seedUser("alive");
        stubActor(actor);

        const res = yield* postCompany(buildTestApp());

        expect(res.status).toBe(200);
        const body = (yield* responseJson(res)) as { membership: { role: string } };
        expect(body.membership.role).toBe("OWNER");
      }),
    ));
});
