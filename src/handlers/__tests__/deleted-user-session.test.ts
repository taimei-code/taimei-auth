import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { buildTestApp, createSeedHelpers, restoreActor, stubActor } from "./helpers";

// 削除済み user の session で書き込み route を叩いた時の fail-closed 契約を固定する。
// better-auth cookieCache (最大 5 分) は user 行の削除後も session を返し続けるため、
// guard が DB の user 存在で fail-closed しないと membership insert が FK 違反 500 になる
// (事業所削除 → 連動アカウント削除 → 同 browser で signup/company 再送信、の実障害を再現)。
const P = "dus-test-";
const helpers = createSeedHelpers(P);

const postCompany = (app: Hono) =>
  app.request("/api/account/companies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `${P}co-first`, org_code: "PERSONAL" }),
  });

describe("削除済み user の session actor", () => {
  beforeEach(helpers.cleanup);
  afterEach(restoreActor);
  afterAll(helpers.cleanup);

  test("user 行が存在しない actor の事業所作成は 401 (FK 500 にしない)", async () => {
    stubActor({ id: `${P}u-ghost`, email: `${P}ghost@example.com` });

    const res = await postCompany(buildTestApp());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("user 行が存在する actor の事業所作成は従来どおり成功する", async () => {
    const actor = await helpers.seedUser("alive");
    stubActor(actor);

    const res = await postCompany(buildTestApp());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { membership: { role: string } };
    expect(body.membership.role).toBe("OWNER");
  });
});
