import { expect, test } from "bun:test";
import { Context, Effect, Layer, Schema } from "effect";
import { Command, type Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import { startApplication } from "../start-application";

class MembershipReader extends Context.Service<
  MembershipReader,
  { readonly count: Effect.Effect<number> }
>()("MembershipReader") {}

class UnrelatedService extends Context.Service<UnrelatedService, { readonly ready: boolean }>()(
  "UnrelatedService",
) {}

const Model = Schema.Struct({ count: Schema.Finite });
type Model = typeof Model.Type;
const Message = defineMessageUnion({
  ClickedLink: {},
  ChangedUrl: {},
  CompletedReadCount: { count: Schema.Finite },
});
type Message = typeof Message.Type;

const ReadCount = Command.define("ReadCount", {
  messages: [Message.CompletedReadCount],
  execute: Effect.gen(function* () {
    const reader = yield* MembershipReader;
    const count = yield* reader.count;
    return Message.CompletedReadCount({ count });
  }),
});

const init = (): Update.Return<Model, Message, MembershipReader> => ({
  model: { count: 0 },
  commands: [ReadCount()],
});
const update = (model: Model): Update.Return<Model, Message, MembershipReader> => ({ model });
const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "t",
  body: h.div([], [String(model.count)]),
});
const config = {
  Model,
  init,
  update,
  view,
  container: null,
  routing: { onUrlRequest: () => Message.ClickedLink(), onUrlChange: () => Message.ChangedUrl() },
};

const startWithoutResources = () =>
  // @ts-expect-error Command が使う service の Layer を resources で渡さないと起動できない
  startApplication(config);

const startWithEmptyResources = () =>
  // @ts-expect-error Command が使う service を持たない Layer では起動できない
  startApplication({ ...config, resources: Layer.empty });

const startWithUnrelatedResources = () =>
  // @ts-expect-error Command が使う service と違う service の Layer では起動できない
  startApplication({ ...config, resources: Layer.succeed(UnrelatedService, { ready: true }) });

const startWithDevTools = () =>
  startApplication({
    ...config,
    resources: Layer.succeed(MembershipReader, { count: Effect.succeed(1) }),
    // @ts-expect-error devTools は起動の関数が切るので、呼び手は渡せない
    devTools: {},
  });

const startWithResources = () =>
  startApplication({
    ...config,
    resources: Layer.succeed(MembershipReader, { count: Effect.succeed(1) }),
  });

test("application の起動は、Command が使う service の Layer を必ず受け取る (typecheck で検査する)", () => {
  expect([
    startWithoutResources,
    startWithEmptyResources,
    startWithUnrelatedResources,
    startWithDevTools,
    startWithResources,
  ]).toHaveLength(5);
});
