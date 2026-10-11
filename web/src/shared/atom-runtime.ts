import { Effect, Layer } from "effect";
import { type AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

export const atomRuntime = Atom.runtime(Layer.empty);

export const refreshAndWait = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<A> => {
  registry.refresh(atom);
  return Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }));
};
