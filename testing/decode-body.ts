import { Effect, Schema } from "effect";
import type { Context } from "hono";
import { InvalidArgument } from "../src/failures";

type BodySchema = Schema.Codec<unknown, unknown, never, never>;

const decodeBody = <S extends BodySchema>(readBody: () => Promise<unknown>, schema: S) =>
  Effect.tryPromise(readBody).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new InvalidArgument({})),
  );

const mediaTypeOf = (c: Context) =>
  c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();

export const decodeFormBody = <S extends BodySchema>(c: Context, schema: S) =>
  decodeBody(() => c.req.parseBody(), schema);

export const decodeJsonBody = <S extends BodySchema>(c: Context, schema: S) =>
  mediaTypeOf(c) === "application/json"
    ? decodeBody(() => c.req.json(), schema)
    : Effect.fail(new InvalidArgument({}));
