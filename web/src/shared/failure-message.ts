import { Cause, Option } from "effect";

export const failureMessage = <E extends { readonly _tag: string }>(
  cause: Cause.Cause<E>,
  byTag: { readonly [Tag in E["_tag"]]: string },
  fallback: string,
): string =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => fallback,
    onSome: (error) => byTag[error._tag as E["_tag"]],
  });

export const hasFailureTag = <E extends { readonly _tag: string }>(
  cause: Cause.Cause<E>,
  tag: E["_tag"],
): boolean => Option.exists(Cause.findErrorOption(cause), (error) => error._tag === tag);
