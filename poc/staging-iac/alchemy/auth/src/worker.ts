import { DurableObject } from "cloudflare:workers";
import type { WorkerEnv } from "../alchemy.run.ts";

export default {
  async fetch(request: Request, env: WorkerEnv) {
    const { pathname } = new URL(request.url);
    const counter = env.COUNTER.getByName("counter");
    switch (pathname) {
      case "/":
        return new Response("poc-iac-alc-auth ok");
      case "/do/inc":
        return new Response(String(await counter.inc()));
      case "/do/get":
        return new Response(String(await counter.get()));
      case "/secret-length":
        return new Response(String(env.POC_SECRET.length));
      case "/hyperdrive-bound":
        return new Response(String(typeof env.HD.connectionString === "string"));
      default:
        return new Response("not found", { status: 404 });
    }
  },
  async scheduled() {},
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
