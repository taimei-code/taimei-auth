import type { Context } from "hono";
import type { z } from "zod";
import type { ParseBodyCallback } from "../membership/guard";

// Transport 層で「c.req.json() + zod safeParse」を entry の parseBody callback に接続する adapter。
// 4 route (account-invitation / account-membership) が同形の 3〜5 行を書いていたのを 1 箇所に閉じる。
// 「.catch(() => null) を safeParse より先に置く」不変条件 (invalid JSON body を 400 に変換するため
// throw を握る) を helper 内に隠蔽し、handler は schema + optional transform だけを渡す。
// withDetails=true は details 付き 400 が現行挙動の 3 route (signup 作成 / add / 招待作成) 向けで、
// 他 route は details 無しの定型 400 を返す (SPA が期待する response shape の差分を維持)。

type ParseZodBodyOptions<S extends z.ZodTypeAny, Out> = {
  withDetails?: boolean;
  transform?: (data: z.infer<S>) => Out;
};

export function parseZodBody<S extends z.ZodTypeAny, Out = z.infer<S>>(
  c: Context,
  schema: S,
  opts: ParseZodBodyOptions<S, Out> = {},
): ParseBodyCallback<Out> {
  return async () => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return opts.withDetails ? { ok: false, details: parsed.error.flatten() } : { ok: false };
    }
    const data = (opts.transform ? opts.transform(parsed.data) : parsed.data) as Out;
    return { ok: true, data };
  };
}
