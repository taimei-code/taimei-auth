import { expect, test } from "bun:test";
import { Effect } from "effect";
import { Command, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";

import { Unauthorized } from "@core/failures";

const Message = defineMessageUnion({ CompletedLoad: {}, ExpiredSession: {} });
type Message = typeof Message.Type;
type Model = { readonly count: number };

const LoadLeavingUnauthorized = Command.define("LoadLeavingUnauthorized", {
  messages: [Message.CompletedLoad],
  execute: Effect.fail(new Unauthorized()).pipe(Effect.as(Message.CompletedLoad())),
});

const LoadHandlingUnauthorized = Command.define("LoadHandlingUnauthorized", {
  messages: [Message.CompletedLoad, Message.ExpiredSession],
  execute: Effect.fail(new Unauthorized()).pipe(
    Effect.as(Message.CompletedLoad()),
    Effect.catchTag("Unauthorized", () => Effect.succeed(Message.ExpiredSession())),
  ),
});

const updateLeavingUnauthorized = (model: Model): Update.Return<Model, Message> => ({
  model,
  // @ts-expect-error Unauthorized を Message にし忘れた Command は update が返せない
  commands: [LoadLeavingUnauthorized()],
});

const updateHandlingUnauthorized = (model: Model): Update.Return<Model, Message> => ({
  model,
  commands: [LoadHandlingUnauthorized()],
});

test("Command の失敗に Unauthorized が残ると update が返せない (typecheck で検査する)", () => {
  expect([updateLeavingUnauthorized, updateHandlingUnauthorized]).toHaveLength(2);
});
