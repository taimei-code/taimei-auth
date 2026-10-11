// E Hono + @hono/zod-openapi (zod で宣言) + hono/client
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Effect } from "effect";
import { hc } from "hono/client";

const runRoute = async (_c: unknown, response: Response): Promise<Response> => response;
const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const changeRole = createRoute({
  method: "post",
  path: "/api/account/companies/{companyId}/members/{targetUserId}/role",
  request: {
    params: z.object({ companyId: z.string(), targetUserId: z.string() }),
    body: { content: { "application/json": { schema: z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) }) } } },
  },
  responses: { 200: json(z.object({ ok: z.literal(true) }), "ok"), 409: json(z.object({ error: z.literal("last_owner") }), "last owner") },
});
const app = new OpenAPIHono().openapi(changeRole, (c) => c.json({ ok: true as const }, 200));
// @ts-expect-error K6 宣言した route を app.openapi() に渡さない (handler の書き漏れ)
export const removeMember = createRoute({ method: "post", path: "/api/account/companies/{companyId}/members/{targetUserId}/remove", request: { params: z.object({ companyId: z.string(), targetUserId: z.string() }) }, responses: { 200: json(z.object({ ok: z.literal(true) }), "ok") } });
const client = hc<typeof app>("/");
const role = client.api.account.companies[":companyId"].members[":targetUserId"].role;

// @ts-expect-error K3 応答の形が宣言と違う
new OpenAPIHono().openapi(changeRole, (c) => c.json({ wrong: 1 }, 200));
// @ts-expect-error K4 宣言のない失敗 (403) を返す
new OpenAPIHono().openapi(changeRole, (c) => c.json({ error: "forbidden" }, 403));
// @ts-expect-error E1 Effect を走らせて Response を返す adapter (今の runRoute の形) は使えない
new OpenAPIHono().openapi(changeRole, (c) => runRoute(c, new Response("{}")));

export async function probes() {
  // @ts-expect-error K1 URL の打ち間違い
  await client.api.account.companeis[":companyId"].members[":targetUserId"].role.$post({ param: { companyId: "x", targetUserId: "u" }, json: { role: "ADMIN" } });
  // @ts-expect-error K2 body の型違い
  await role.$post({ param: { companyId: "x", targetUserId: "u" }, json: { role: "BOSS" } });
  const res = await role.$post({ param: { companyId: "x", targetUserId: "u" }, json: { role: "ADMIN" } });
  // @ts-expect-error K5 宣言にない失敗 (status 418) を扱う
  if (res.status === 418) return;
  // @ts-expect-error E2 client が Effect を返す
  const e2: Effect.Effect<unknown, unknown> = role.$post({ param: { companyId: "x", targetUserId: "u" }, json: { role: "ADMIN" } });
  // @ts-expect-error K1b handler の無い endpoint を呼ぶ
  await client.api.account.nonexistent.$get();
  return [e2, Effect];
}
