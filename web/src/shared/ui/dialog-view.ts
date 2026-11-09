import { Dialog as FoldkitDialog } from "@foldkit/ui";
import { Option, Schema } from "effect";
import { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { X } from "lucide";

import { dialogClassNames } from "./class-names";
import { iconView } from "./icon-view";

export const Dialog = {
  Model: FoldkitDialog.Model,
  Message: FoldkitDialog.Message,
  init: FoldkitDialog.init,
  ShowDialog: FoldkitDialog.ShowDialog,
  CloseDialog: FoldkitDialog.CloseDialog,
  AcquireResources: FoldkitDialog.AcquireResources,
};
export type DialogModel = FoldkitDialog.Model;
export type DialogMessage = FoldkitDialog.Message;

export type DialogContent = Readonly<{
  title: string;
  description: string;
  body: ReadonlyArray<Html>;
  isClosingBlocked: boolean;
}>;

export const dialogView = <Message>(
  model: DialogModel,
  toParentMessage: (message: DialogMessage) => Message,
  content: DialogContent,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.id,
    model,
    view: FoldkitDialog.view,
    viewInputs: {
      hasDescription: true,
      toView: ({ dialog, backdrop, panel, title, description, closeButton, isVisible }) =>
        h.dialog(
          [...dialog],
          isVisible
            ? [
                h.div([...backdrop, h.Class(dialogClassNames.overlay)]),
                h.div(
                  [...panel, h.Class(dialogClassNames.content)],
                  [
                    h.div(
                      [h.Class(dialogClassNames.header)],
                      [
                        h.h2([...title, h.Class(dialogClassNames.title)], [content.title]),
                        h.p(
                          [...description, h.Class(dialogClassNames.description)],
                          [content.description],
                        ),
                      ],
                    ),
                    ...content.body,
                    h.button(
                      [
                        ...closeButton,
                        h.Disabled(content.isClosingBlocked),
                        h.Class(dialogClassNames.close),
                      ],
                      [iconView(X, h), h.span([h.Class("sr-only")], ["Close"])],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage,
  });

export const dialogFooterView = <Message>(
  children: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html => h.div([h.Class(dialogClassNames.footer)], children);

type ModelWithDialog = Readonly<{ dialog: DialogModel }>;

export type DialogFoldsConfig<Model, Message, OutMessage, R> = Readonly<{
  toParentMessage: (message: DialogMessage) => Message;
  write: (model: Model, nextDialog: DialogModel) => Model;
  whenClosed?: Update.StepWithOutMessage<Model, Message, OutMessage, R>;
  isClosingBlocked: (model: Model) => boolean;
}>;

export const dialogFoldsOf = <
  Model extends ModelWithDialog,
  Message,
  OutMessage = never,
  R = never,
>(
  config: DialogFoldsConfig<Model, Message, OutMessage, R>,
) => {
  const child = {
    read: (model: Model) => Option.some(model.dialog),
    write: config.write,
    toParentMessage: config.toParentMessage,
    foldOutMessage: FoldkitDialog.OutMessage.match<
      Update.StepWithOutMessage<Model, Message, OutMessage, R>
    >({
      Opened: () => (model) => ({ model }),
      Closed: () => config.whenClosed ?? ((model) => ({ model })),
    }),
  };
  const foldDialog = Update.foldChild({ ...child, update: FoldkitDialog.update });
  return {
    fold: (model: Model, message: DialogMessage) =>
      config.isClosingBlocked(model) && Schema.is(FoldkitDialog.Message.RequestedClose)(message)
        ? { model }
        : foldDialog(model, message),
    open: Update.foldChildStep({ ...child, update: FoldkitDialog.open }),
    close: Update.foldChildStep({ ...child, update: FoldkitDialog.close }),
  };
};
