import { Effect, Schema, SchemaIssue } from "effect";
import type { z } from "zod";

export const fromZodSearch = <T>(schema: z.ZodType<T>) =>
  Schema.declareConstructor<T, Readonly<Record<string, string>>>()([], () => (input) => {
    const parsed = schema.safeParse(input);
    return parsed.success
      ? Effect.succeed(parsed.data)
      : Effect.fail(new SchemaIssue.InvalidValue({ message: parsed.error.message }, input));
  });
