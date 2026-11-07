import { expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { Command, type Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import { SpaHttpClient } from "../../shared/spa-http-client";
import { startRoutingApplication } from "../start-application";

const Model = Schema.Struct({ count: Schema.Finite });
type Model = typeof Model.Type;
const Message = defineMessageUnion({ ClickedLink: {}, ChangedUrl: {}, CompletedRead: {} });
type Message = typeof Message.Type;

const ReadMemberships = Command.define("ReadMemberships", {
  messages: [Message.CompletedRead],
  execute: Effect.gen(function* () {
    yield* SpaHttpClient;
    return Message.CompletedRead();
  }),
});

const init = (): Update.Return<Model, Message, SpaHttpClient> => ({
  model: { count: 0 },
  commands: [ReadMemberships()],
});
const update = (model: Model): Update.Return<Model, Message, SpaHttpClient> => ({ model });
const view = (_: Model, h: HtmlBuilder<Message>): Document => ({ title: "t", body: h.div([], []) });
const routing = {
  onUrlRequest: () => Message.ClickedLink(),
  onUrlChange: () => Message.ChangedUrl(),
};

const withoutResources = { Model, init, update, view, routing, container: null };
const withEmptyResources = { ...withoutResources, resources: Layer.empty };

const startWithoutResources = () =>
  // @ts-expect-error Command が使う service を resources で渡さないと起動できない
  startRoutingApplication(withoutResources);

const startWithEmptyResources = () =>
  // @ts-expect-error Command が使う service を持たない Layer では起動できない
  startRoutingApplication(withEmptyResources);

test("application の起動は、Command が使う service の Layer を必ず受け取る", () => {
  expect([startWithoutResources, startWithEmptyResources]).toHaveLength(2);
});
