import { Duration, Effect, Number, Redacted, Schema } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { Check, Copy } from "lucide";

import { Submission } from "../shared/submission";
import { buttonView } from "../shared/ui/button-view";

const CopyResult = defineTaggedUnion({
  Idle: {},
  Copied: {},
  NotCopied: {},
});
type CopyResult = typeof CopyResult.Type;

export const Model = Schema.Struct({
  result: CopyResult,
  shownNumber: Schema.Int,
});
export type Model = typeof Model.Type;

const CopiedText = Schema.Redacted(Schema.String);

export const Message = defineMessageUnion({
  ClickedCopy: { text: CopiedText },
  SucceededCopyText: {},
  FailedCopyText: {},
  CompletedWaitBeforeHidingCopyResult: { shownNumber: Schema.Int },
});
export type Message = typeof Message.Type;

type ViewInputs = Readonly<{ text: Redacted.Redacted<string>; label: string }>;

const COPY_RESULT_DISPLAY = Duration.seconds(3);

export const CopyText = Command.define("CopyText", {
  args: { text: CopiedText },
  messages: [Message.SucceededCopyText, Message.FailedCopyText],
  execute: ({ text }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(Redacted.value(text))).pipe(
      Effect.as(Message.SucceededCopyText()),
      Effect.catchTag("UnknownError", () => Effect.succeed(Message.FailedCopyText())),
    ),
});

export const WaitBeforeHidingCopyResult = Command.define("WaitBeforeHidingCopyResult", {
  args: { shownNumber: Schema.Int },
  messages: [Message.CompletedWaitBeforeHidingCopyResult],
  execute: ({ shownNumber }) =>
    Effect.sleep(COPY_RESULT_DISPLAY).pipe(
      Effect.as(Message.CompletedWaitBeforeHidingCopyResult({ shownNumber })),
    ),
});

export const init = (): Model => ({ result: CopyResult.Idle(), shownNumber: 0 });

type UpdateReturn = Update.Return<Model, Message>;

const show = (model: Model, result: CopyResult): UpdateReturn => {
  const shown = modifyFields(model, { result: () => result, shownNumber: Number.increment });
  return {
    model: shown,
    commands: [WaitBeforeHidingCopyResult({ shownNumber: shown.shownNumber })],
  };
};

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedCopy: ({ text }) => ({ model, commands: [CopyText({ text })] }),
    SucceededCopyText: () => show(model, CopyResult.Copied()),
    FailedCopyText: () => show(model, CopyResult.NotCopied()),
    CompletedWaitBeforeHidingCopyResult: ({ shownNumber }) => ({
      model:
        shownNumber === model.shownNumber
          ? modifyFields(model, { result: () => CopyResult.Idle() })
          : model,
    }),
  });

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, { text, label }, h) =>
  h.div(
    [h.Class("flex items-center gap-2")],
    [
      buttonView(
        {
          label,
          type: "button",
          look: "outlineSmall",
          submission: Submission.Idle(),
          isBlocked: false,
          onClick: Message.ClickedCopy({ text }),
          icon: CopyResult.guards.Copied(model.result) ? Check : Copy,
        },
        h,
      ),
      ...CopyResult.match(model.result, {
        Idle: () => [],
        Copied: () => [h.span([h.Class("text-xs text-muted-foreground")], ["コピーしました"])],
        NotCopied: () => [
          h.span([h.Class("text-xs text-destructive")], ["コピーできませんでした"]),
        ],
      }),
    ],
  ),
);
