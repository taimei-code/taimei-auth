import { DurableObject } from "cloudflare:workers";

interface Env {
  COUNTER: DurableObjectNamespace<Counter>;
}

export default {
  async fetch(request: Request, env: Env) {
    const { pathname } = new URL(request.url);
    const counter = env.COUNTER.getByName("counter");
    switch (pathname) {
      case "/":
        return new Response("poc-iac-alc-legacy ok");
      case "/do/inc":
        return new Response(String(await counter.inc()));
      case "/do/get":
        return new Response(String(await counter.get()));
      default:
        return new Response("not found", { status: 404 });
    }
  },
};

export class Counter extends DurableObject {
  get() {
    return this.ctx.storage.kv.get<number>("n") ?? 0;
  }

  inc() {
    const next = this.get() + 1;
    this.ctx.storage.kv.put("n", next);
    return next;
  }
}
