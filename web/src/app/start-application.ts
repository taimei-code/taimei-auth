import type { Layer } from "effect";
import { Runtime } from "foldkit";

type StartableConfig<Model, Message extends { _tag: string }, Resources> = Omit<
  Runtime.RoutingApplicationConfig<Model, Message, Resources>,
  "devTools" | "freezeModel" | "slow" | "resources"
> &
  Readonly<{ resources: Layer.Layer<NoInfer<Resources>> }>;

export const startApplication = <Model, Message extends { _tag: string }, Resources>(
  config: StartableConfig<Model, Message, Resources>,
) => Runtime.run(Runtime.makeApplication({ ...config, devTools: false }));
