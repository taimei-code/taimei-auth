import type { ReactNode } from "react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Loader2 } from "lucide-react";

import { failedBeforeAnyValue } from "./atom-runtime";

export const LoadingRow = () => (
  <div className="flex justify-center py-12" role="status" aria-live="polite">
    <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    <span className="sr-only">読み込み中…</span>
  </div>
);

export const AsyncSection = <A, E>({
  result,
  failedText,
  empty,
  children,
}: {
  result: AsyncResult.AsyncResult<A, E>;
  failedText: string;
  empty?: { readonly when: (value: A) => boolean; readonly text: string };
  children: (value: A) => ReactNode;
}) => {
  if (failedBeforeAnyValue(result))
    return (
      <p role="alert" className="text-sm text-destructive">
        {failedText}
      </p>
    );
  const value = AsyncResult.value(result);
  if (Option.isNone(value)) return <LoadingRow />;
  if (empty?.when(value.value))
    return <p className="text-sm text-muted-foreground">{empty.text}</p>;
  return <>{children(value.value)}</>;
};
