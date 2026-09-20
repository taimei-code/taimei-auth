// E1: miniflare を library として Bun から起動し、KvStore DO を叩く。実行: bun run e1-miniflare.ts
import { Miniflare } from "miniflare";

const script = `
import { DurableObject } from "cloudflare:workers";
export class KvStore extends DurableObject {
  async get() { const e = await this.ctx.storage.get("e"); if (!e) return null; if (e.expiresAt !== null && e.expiresAt <= Date.now()) { await this.ctx.storage.deleteAll(); return null; } return e.value; }
  async set(value, ttlSec) { const expiresAt = ttlSec ? Date.now() + ttlSec * 1000 : null; await this.ctx.storage.put("e", { value, expiresAt }); if (expiresAt !== null) await this.ctx.storage.setAlarm(expiresAt); }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const stub = env.KV_STORE.get(env.KV_STORE.idFromName(url.searchParams.get("k")));
    if (url.pathname === "/set") { await stub.set(url.searchParams.get("v"), Number(url.searchParams.get("n") ?? 0) || undefined); return Response.json({ ok: true }); }
    return Response.json({ v: await stub.get(), runtime: typeof Bun });
  },
};
`;

const mf = new Miniflare({
  modules: true,
  script,
  compatibilityDate: "2025-04-01",
  durableObjects: { KV_STORE: { className: "KvStore", useSQLite: true } },
});
const base = await mf.ready;
const call = async (p: string) => (await mf.dispatchFetch(new URL(p, base))).json();

console.log("process:", typeof Bun !== "undefined" ? `Bun ${Bun.version}` : "not bun");
await call("/set?k=a&v=hello");
const got = await call("/get?k=a");
await call("/set?k=ttl&v=x&n=1");
const before = await call("/get?k=ttl");
await new Promise((r) => setTimeout(r, 1500));
const after = await call("/get?k=ttl");
console.log(JSON.stringify({ got, before, after }));
const ok = got.v === "hello" && before.v === "x" && after.v === null;
console.log(ok ? "PASS" : "FAIL");
await mf.dispose();
process.exit(ok ? 0 : 1);
