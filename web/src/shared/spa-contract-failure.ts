import { Effect, Schema } from "effect";

import type { TransportFailure } from "./spa-http-client";

const UNEXPECTED = "Unexpected";
type Unexpected = typeof UNEXPECTED;

const TRANSPORT_FAILURES = {
  HttpClientError: UNEXPECTED,
  SchemaError: UNEXPECTED,
} as const satisfies Record<TransportFailure["_tag"], Unexpected>;
type TransportFailureTag = keyof typeof TRANSPORT_FAILURES;

type Tagged = { readonly _tag: string };

type Settled<E extends Tagged, Tag extends string> = Extract<
  E,
  { readonly _tag: Tag | TransportFailureTag }
>;

type DeclaredBy<E extends Tagged> = Exclude<E["_tag"], TransportFailureTag>;

export const contractFailure = <const Distinguished extends ReadonlyArray<string>>(
  distinguished: Distinguished,
) => Schema.Literals([...distinguished, UNEXPECTED]);

export const UndistinguishedFailure = contractFailure([]);

export const messageOnFailure =
  <
    const Distinguished extends ReadonlyArray<string>,
    const AsUnexpected extends ReadonlyArray<string>,
    M,
  >(settling: {
    readonly failure: Schema.Literals<readonly [...Distinguished, Unexpected]>;
    readonly asUnexpected: AsUnexpected &
      ReadonlyArray<Exclude<AsUnexpected[number], Distinguished[number] | TransportFailureTag>>;
    readonly toMessage: (failure: Distinguished[number] | Unexpected) => M;
  }) =>
  <A, E extends Tagged, R>(
    call: Effect.Effect<A, E, R> &
      ([Exclude<Distinguished[number] | AsUnexpected[number], TransportFailureTag>] extends [
        DeclaredBy<E>,
      ]
        ? unknown
        : {
            readonly 契約に無い失敗を一覧に書いている: Exclude<
              Distinguished[number] | AsUnexpected[number],
              DeclaredBy<E>
            >;
          }),
  ): Effect.Effect<
    A | M,
    Exclude<E, Settled<E, Distinguished[number] | AsUnexpected[number]>>,
    R
  > => {
    const failureByTag = new Map<string, Distinguished[number] | Unexpected>([
      ...Object.entries(TRANSPORT_FAILURES),
      ...settling.asUnexpected.map((tag): [string, Unexpected] => [tag, UNEXPECTED]),
      ...settling.failure.literals
        .slice(0, -1)
        .map((failure): [string, typeof failure] => [failure, failure]),
    ]);
    const settled = Effect.catchIf(
      call,
      (error): error is Settled<E, Distinguished[number] | AsUnexpected[number]> =>
        failureByTag.has(error._tag),
      (error) => Effect.succeed(settling.toMessage(failureByTag.get(error._tag) ?? UNEXPECTED)),
    );
    return settled;
  };
