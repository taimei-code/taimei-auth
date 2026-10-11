// A 現状: Hono + runRoute (Response を返す) + web の手書き fetch
import { Hono } from "hono";

type Role = "OWNER" | "ADMIN" | "MEMBER";
const runRoute = async (_c: unknown, response: Response): Promise<Response> => response;
async function getJson<T>(url: string): Promise<T> { return (await fetch(url)).json() as Promise<T>; }
async function postJson<T>(url: string, body?: unknown): Promise<T> { return (await fetch(url, { method: "POST", body: JSON.stringify(body) })).json() as Promise<T>; }
class RequestJsonError extends Error { constructor(readonly status: number) { super(String(status)); } }
const describe = (e: unknown, byStatus: Partial<Record<number, string>> & { fallback: string }) => e instanceof RequestJsonError ? (byStatus[e.status] ?? byStatus.fallback) : byStatus.fallback;

const app = new Hono();
// @ts-expect-error K3 server の応答の形が web の想定と違う
app.get("/api/account/companies/:companyId/members", (c) => runRoute(c, c.json({ wrong: 1 })));
// @ts-expect-error K4 server が宣言のない失敗 (418) を返す
app.post("/api/account/companies/:companyId/members/:targetUserId/role", (c) => runRoute(c, c.json({ error: "teapot" }, 418)));

export async function client() {
  // @ts-expect-error K1 URL の打ち間違い
  await getJson<{ members: { user_id: string }[] }>("/api/account/companeis/x/members");
  // @ts-expect-error K2 body の型違い
  await postJson("/api/account/companies/x/members/u/role", { role: "BOSS" as Role | "BOSS" });
  // @ts-expect-error K5 宣言にない失敗 (status 418) を扱う
  describe(new Error(), { 418: "teapot", fallback: "x" });
  // @ts-expect-error K6 handler の無い endpoint を呼ぶ
  await getJson("/api/account/nonexistent");
}
