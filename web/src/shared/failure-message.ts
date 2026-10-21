import { Cause, Option } from "effect";

import type { Unauthorized } from "@core/failures";

export type FailureOutcomes<E extends { readonly _tag: string }, A> = {
  readonly [Tag in Exclude<E["_tag"], Unauthorized["_tag"]>]: A;
};

export type FailureMessages<E extends { readonly _tag: string }> = FailureOutcomes<E, string>;

export const failureOutcome = <E extends { readonly _tag: string }, A>(
  cause: Cause.Cause<E>,
  byTag: FailureOutcomes<E, A>,
  fallback: NoInfer<A>,
): A => {
  const outcomes: { readonly [tag: string]: A | undefined } = byTag;
  return Option.match(Cause.findErrorOption(cause), {
    onNone: () => fallback,
    onSome: (error) => outcomes[error._tag] ?? fallback,
  });
};

export const failureMessage = <E extends { readonly _tag: string }>(
  cause: Cause.Cause<E>,
  byTag: FailureMessages<E>,
  fallback: string,
): string => failureOutcome(cause, byTag, fallback);
