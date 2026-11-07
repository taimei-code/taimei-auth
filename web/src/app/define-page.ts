import type { Schema } from "effect";
import type { Submodel, Update } from "foldkit";

const pageBrand = Symbol("Page");

type PageParts<Model, Message, Route, Resources> = Readonly<{
  Model: Schema.Codec<Model, unknown, never, never>;
  init: (route: Route) => Update.Return<Model, Message, Resources>;
  update: (model: Model, message: Message) => Update.Return<Model, Message, Resources>;
  view: Submodel.View<Model, Message>;
}>;

export type Page<Model, Message, Route, Resources> = PageParts<Model, Message, Route, Resources> &
  Readonly<{ [pageBrand]: true }>;

export const definePage = <Model, Message, Route, Resources = never>(
  parts: PageParts<Model, Message, Route, Resources>,
): Page<Model, Message, Route, Resources> => ({ ...parts, [pageBrand]: true });
