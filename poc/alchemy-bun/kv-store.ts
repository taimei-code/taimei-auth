// E2: 親 PoC の KvStore を alchemy 2.0 の DurableObject 様式で書いたもの (get / set(ttl) / alarm 失効のみ)
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

type Entry = { value: string; expiresAt: number | null };

export default class KvStore extends Cloudflare.DurableObject<KvStore>()(
  "KvStore",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      const live = Effect.gen(function* () {
        const e = yield* state.storage.get<Entry>("e");
        if (!e) return null;
        if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
          yield* state.storage.deleteAll();
          return null;
        }
        return e;
      });
      return {
        get: () => live.pipe(Effect.map((e) => e?.value ?? null)),
        set: (value: string, ttlSec?: number) =>
          Effect.gen(function* () {
            const expiresAt = ttlSec ? Date.now() + ttlSec * 1000 : null;
            yield* state.storage.put<Entry>("e", { value, expiresAt });
            if (expiresAt !== null) yield* state.storage.setAlarm(expiresAt);
          }),
        alarm: () => state.storage.deleteAll(),
      };
    });
  }),
) {}
