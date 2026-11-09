import { Clock, Duration, Effect, Redacted, Schema } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { Check, Copy } from "lucide";

import { Submission } from "../shared/submission";
import { buttonView } from "../shared/ui/button-view";

const EpochMillis = Schema.Int;

export const Model = defineTaggedUnion({
  Idle: {},
  Copied: { shownAt: EpochMillis },
  NotCopied: { shownAt: EpochMillis },
});
export type Model = typeof Model.Type;

const CopiedText = Schema.Redacted(Schema.String);

export const Message = defineMessageUnion({
  ClickedCopy: { text: CopiedText },
  SucceededCopyText: { shownAt: EpochMillis },
  FailedCopyText: { shownAt: EpochMillis },
  CompletedWaitBeforeHidingCopyResult: { shownAt: EpochMillis },
});
export type Message = typeof Message.Type;

type ViewInputs = Readonly<{ text: Redacted.Redacted<string>; label: string }>;

const COPY_RESULT_DISPLAY = Duration.seconds(3);

export const CopyText = Command.define("CopyText", {
  args: { text: CopiedText },
  messages: [Message.SucceededCopyText, Message.FailedCopyText],
  execute: ({ text }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(Redacted.value(text))).pipe(
      Effect.as(Message.SucceededCopyText),
      Effect.catchTag("UnknownError", () => Effect.succeed(Message.FailedCopyText)),
      Effect.flatMap((toMessage) =>
        Effect.map(Clock.currentTimeMillis, (shownAt) => toMessage({ shownAt })),
      ),
    ),
});

export const WaitBeforeHidingCopyResult = Command.define("WaitBeforeHidingCopyResult", {
  args: { shownAt: EpochMillis },
  messages: [Message.CompletedWaitBeforeHidingCopyResult],
  execute: ({ shownAt }) =>
    Effect.sleep(COPY_RESULT_DISPLAY).pipe(
      Effect.as(Message.CompletedWaitBeforeHidingCopyResult({ shownAt })),
    ),
});

export const init = (): Model => Model.Idle();

const show = (shown: typeof Model.Copied.Type | typeof Model.NotCopied.Type) => ({
  model: shown,
  commands: [WaitBeforeHidingCopyResult({ shownAt: shown.shownAt })],
});

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedCopy: ({ text }) => ({ model, commands: [CopyText({ text })] }),
    SucceededCopyText: ({ shownAt }) => show(Model.Copied({ shownAt })),
    FailedCopyText: ({ shownAt }) => show(Model.NotCopied({ shownAt })),
    CompletedWaitBeforeHidingCopyResult: ({ shownAt }) => ({
      model: !Model.guards.Idle(model) && model.shownAt === shownAt ? Model.Idle() : model,
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
          icon: Model.guards.Copied(model) ? Check : Copy,
        },
        h,
      ),
      ...Model.match(model, {
        Idle: () => [],
        Copied: () => [h.span([h.Class("text-xs text-muted-foreground")], ["コピーしました"])],
        NotCopied: () => [
          h.span([h.Class("text-xs text-destructive")], ["コピーできませんでした"]),
        ],
      }),
    ],
  ),
);
