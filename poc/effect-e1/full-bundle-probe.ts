// PoC (案 E1): 現行の本番 Worker (src/worker.ts) に Effect を同梱したときの bundle 増分を測るための entry。
// 実行はせず wrangler deploy --dry-run のサイズ計測にだけ使う。
import { Effect } from "effect";
import handler from "../../src/worker";

export default {
  ...handler,
  fetch: (req: Request, env: never, ctx: never) =>
    Effect.runPromise(Effect.promise(() => handler.fetch(req, env, ctx))),
};
