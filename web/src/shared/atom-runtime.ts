import { RegistryContext } from "@effect/atom-react";
import { Effect, Option } from "effect";
import { AsyncResult, type Atom, AtomRegistry } from "effect/reactivity";
import { use, useCallback } from "react";

export const waitForValue = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<A> =>
  Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }));

export const refreshAndWait = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<A> => {
  registry.refresh(atom);
  return waitForValue(registry, atom);
};

export const useWaitForValue = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) => {
  const registry = use(RegistryContext);
  return useCallback(() => waitForValue(registry, atom), [registry, atom]);
};

export const useRefreshAndWait = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) => {
  const registry = use(RegistryContext);
  return useCallback(() => refreshAndWait(registry, atom), [registry, atom]);
};

export const failedBeforeAnyValue = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): result is AsyncResult.Failure<A, E> =>
  AsyncResult.isFailure(result) && Option.isNone(result.previousSuccess);
