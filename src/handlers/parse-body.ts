import type { Context } from "hono";
import { z } from "zod";
import type { Role } from "@/db/repositories/membership";
import type { ParseBodyCallback } from "../membership/guard";
import type { MfaCodeKind } from "../mfa/wire-contracts";

// role を body で受ける 2 route が同じ値集合を受理するための共有 schema (片方だけ受理する非対称を防ぐ)。
// 値集合の SSOT は db/schema.ts の Role (satisfies が Role に無い値の混入を型エラーで検出する)。
export const roleBodySchema = z.enum([
  "OWNER",
  "ADMIN",
  "MEMBER",
] as const satisfies readonly Role[]);

// 桁数を縛らないのは TOTP とリカバリーコードで書式が異なり、書式判定を Transport が持つと誤入力が
// invalid_argument になり SPA の invalid_code 分岐から外れるため。string 固定は先頭 0 の保持。
export const mfaCodeSchema = z.string().min(1).max(64);

export const mfaCodeKindSchema = z.enum([
  "totp",
  "recovery_code",
] as const satisfies readonly MfaCodeKind[]);

type ParseZodBodyOptions<S extends z.ZodTypeAny, Out> = {
  withDetails?: boolean;
  transform?: (data: z.infer<S>) => Out;
};

// c.req.json() + zod safeParse を entry の parseBody callback に接続する adapter。「.catch を safeParse
// より先に置く」不変条件を隠蔽する。withDetails は details 付き 400 を返す 3 route 向け。
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
