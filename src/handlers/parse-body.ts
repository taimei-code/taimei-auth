import { Effect } from "effect";
import type { Context } from "hono";
import { z } from "zod";
import type { Role } from "@/db/repositories/membership";
import type { ParseBody } from "../membership/guard";
import { InvalidArgument } from "../membership/guard/errors";
import type { MfaCodeKind } from "../mfa/wire-contracts";

export const roleBodySchema = z.enum([
  "OWNER",
  "ADMIN",
  "MEMBER",
] as const satisfies readonly Role[]);
const _roleBodySchemaIsExhaustive: [
  Exclude<Role, (typeof roleBodySchema.options)[number]>,
] extends [never]
  ? true
  : never = true;

// 桁数を縛らないのは、書式判定を Transport が持つと誤入力が invalid_argument になり SPA の分岐から外れるため。
export const mfaCodeSchema = z.string().min(1).max(64);

export const mfaCodeKindSchema = z.enum([
  "totp",
  "recovery_code",
] as const satisfies readonly MfaCodeKind[]);

const parse =
  (details: boolean) =>
  <S extends z.ZodType>(c: Context, schema: S): ParseBody<z.output<S>> =>
    Effect.promise(async () => schema.safeParse(await c.req.json().catch(() => null))).pipe(
      Effect.flatMap((parsed) =>
        parsed.success
          ? Effect.succeed(parsed.data)
          : new InvalidArgument(details ? { details: parsed.error.flatten() } : {}),
      ),
    );

export const parseZodBody = parse(false);
export const parseZodBodyWithDetails = parse(true);
