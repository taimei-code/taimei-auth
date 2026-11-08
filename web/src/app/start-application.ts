import type { Effect, Layer } from "effect";
import { Runtime } from "foldkit";

type FixedByStart = "devTools" | "freezeModel" | "slow" | "resources";

type StartableConfig<Model, Message extends { _tag: string }, Resources> = Omit<
  Runtime.RoutingApplicationConfig<Model, Message, Resources>,
  FixedByStart
> &
  Readonly<{ resources: Layer.Layer<NoInfer<Resources>> }>;

export const startApplication = <Model, Message extends { _tag: string }, Resources>(
  config: StartableConfig<Model, Message, Resources>,
) => Runtime.run(Runtime.makeApplication({ ...config, devTools: false }));

type StartableWithFlagsConfig<Model, Message extends { _tag: string }, Flags, Resources> = Omit<
  Runtime.ApplicationConfigWithFlags<Model, Message, Flags, Resources>,
  FixedByStart
> &
  Readonly<{ resources: Layer.Layer<NoInfer<Resources>>; flags: Effect.Effect<Flags> }>;

export const startApplicationWithFlags = <
  Model,
  Message extends { _tag: string },
  Flags,
  Resources,
>({
  flags,
  ...config
}: StartableWithFlagsConfig<Model, Message, Flags, Resources>) =>
  Runtime.run(Runtime.makeApplication({ ...config, devTools: false }), { flags });
