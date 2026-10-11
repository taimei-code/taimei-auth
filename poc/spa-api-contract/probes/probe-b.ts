// B Hono + hono/client (server から推論)
import { Effect } from "effect";
import { Hono } from "hono";
import { hc } from "hono/client";
import { validator } from "hono/validator";

type Role = "OWNER" | "ADMIN" | "MEMBER";
const runRoute = async (_c: unknown, response: Response): Promise<Response> => response;

const app = new Hono()
  .get("/api/account/companies/:companyId/members", (c) => runRoute(c, c.json({ members: [{ user_id: "u" }] })))
  .post("/api/account/companies/:companyId/members/:targetUserId/role", validator("json", (v) => v as { role: Role }), (c) => runRoute(c, c.json({ ok: true })));
const client = hc<typeof app>("/");
const members = client.api.account.companies[":companyId"].members;

export async function probes() {
  // @ts-expect-error K1 URL の打ち間違い
  await client.api.account.companeis[":companyId"].members.$get({ param: { companyId: "x" } });
  // @ts-expect-error K2 body の型違い
  await members[":targetUserId"].role.$post({ param: { companyId: "x", targetUserId: "u" }, json: { role: "BOSS" } });
  const res = await members.$get({ param: { companyId: "x" } });
  const body = await res.json();
  // @ts-expect-error K3 応答の形の想定違い (server の Response は型を持たず body が unknown。読むには cast が要る)
  const n: number = body.whatever;
  // @ts-expect-error K5 宣言にない失敗 (status 418) を扱う
  if (res.status === 418) return n;
  // @ts-expect-error E2 client が Effect を返す
  const e2: Effect.Effect<unknown, unknown> = members.$get({ param: { companyId: "x" } });
  // @ts-expect-error K6 handler の無い endpoint を呼ぶ
  await client.api.account.nonexistent.$get();
  return [e2, Effect];
}
// @ts-expect-error K4 server が宣言のない失敗を返す
new Hono().get("/x", (c) => runRoute(c, c.json({ error: "teapot" }, 418)));
