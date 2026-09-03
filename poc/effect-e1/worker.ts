// PoC (案 E1) の Worker entry。src/worker.ts の fetch と同じ形 (runWithRequestPool → withWaitUntil →
// finally で pool.end() を waitUntil) の内側で Effect の program を走らせる。
import { runWithRequestPool } from "../../db/client";
import { runBackground, withWaitUntil } from "../../src/background";
import { backgroundTask, type Observation, program, reqStore, runtime } from "./program";

type Env = { DATABASE_URL: string };
type ExecutionCtx = { waitUntil: (promise: Promise<unknown>) => void };

// isolate 内で完走した background task の観測値。/bg で読む。
const backgroundDone: Observation[] = [];

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/bg") return Response.json({ done: backgroundDone });
    const id = url.searchParams.get("id") ?? "none";
    const backgroundPromises: Promise<unknown>[] = [];
    return runWithRequestPool(env.DATABASE_URL, async (pool) => {
      try {
        return await withWaitUntil(
          (p) => {
            backgroundPromises.push(p);
          },
          () =>
            reqStore.run(id, async () => {
              runBackground(
                runtime
                  .runPromise(backgroundTask(id, (o) => backgroundDone.push(o)))
                  .catch(() => undefined),
              );
              const result = await runtime.runPromise(program(id));
              return Response.json(result);
            }),
        );
      } catch (e) {
        return Response.json({ id, ok: false, error: String(e) }, { status: 500 });
      } finally {
        ctx.waitUntil(Promise.allSettled(backgroundPromises).then(() => pool.end()));
      }
    });
  },
};
