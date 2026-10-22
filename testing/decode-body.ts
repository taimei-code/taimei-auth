import { Effect, Schema } from "effect";
import { InvalidArgument } from "../src/failures";

export const decodeBody = <S extends Schema.Codec<unknown, unknown, never, never>>(
  readBody: () => Promise<unknown>,
  schema: S,
) =>
  Effect.tryPromise(readBody).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new InvalidArgument({})),
  );
