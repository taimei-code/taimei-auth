import { KvStore } from "../../src/kv-store.do";

export { KvStore };

type Env = { KV_STORE: { idFromName(n: string): unknown; get(id: unknown): KvStore } };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const k = url.searchParams.get("k") ?? "";
    const v = url.searchParams.get("v") ?? "";
    const n = Number(url.searchParams.get("n") ?? "0");
    const stub = env.KV_STORE.get(env.KV_STORE.idFromName(k));
    switch (url.pathname) {
      case "/get":
        return Response.json({ v: await stub.get() });
      case "/set":
        await stub.set(v, n || undefined);
        return Response.json({ ok: true });
      case "/del":
        await stub.delete();
        return Response.json({ ok: true });
      case "/getdel":
        return Response.json({ v: await stub.getAndDelete() });
      case "/incr":
        return Response.json({ count: await stub.incrementWindow(n) });
      default:
        return new Response("not found", { status: 404 });
    }
  },
};
