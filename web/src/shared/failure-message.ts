import { Cause, Option } from "effect";

import type { Unauthorized } from "@core/membership/guard/errors";

export type FailureMessages<E extends { readonly _tag: string }> = {
  readonly [Tag in Exclude<E["_tag"], Unauthorized["_tag"]>]: string;
};

export const failureMessage = <E extends { readonly _tag: string }>(
  cause: Cause.Cause<E>,
  byTag: FailureMessages<E>,
  fallback: string,
): string => {
  const messages: { readonly [tag: string]: string | undefined } = byTag;
  return Option.match(Cause.findErrorOption(cause), {
    onNone: () => fallback,
    onSome: (error) => messages[error._tag] ?? fallback,
  });
};

export const hasFailureTag = <E extends { readonly _tag: string }>(
  cause: Cause.Cause<E>,
  tag: E["_tag"],
): boolean => Option.exists(Cause.findErrorOption(cause), (error) => error._tag === tag);
