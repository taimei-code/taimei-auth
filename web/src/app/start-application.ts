import type { Layer } from "effect";
import { Runtime } from "foldkit";

type StartableConfig<
  Model,
  Message extends { _tag: string },
  Resources,
> = Runtime.RoutingApplicationConfig<Model, Message, Resources> &
  Readonly<{ resources: Layer.Layer<Resources> }>;

export const startRoutingApplication = <Model, Message extends { _tag: string }, Resources>(
  config: StartableConfig<Model, Message, Resources>,
) => Runtime.run(Runtime.makeApplication({ ...config, devTools: false }));
