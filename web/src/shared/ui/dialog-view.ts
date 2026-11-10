import { Dialog as FoldkitDialog } from "@foldkit/ui";
import { identity, Option, pipe, Schema } from "effect";
import { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { X } from "lucide";

import { dialogClassNames } from "./class-names";
import { iconView } from "./icon-view";

export const Dialog = {
  Model: FoldkitDialog.Model,
  Message: FoldkitDialog.Message,
  init: (config: Omit<FoldkitDialog.InitConfig, "isAnimated">) =>
    FoldkitDialog.init({ ...config, isAnimated: true }),
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
                  [
                    ...panel,
                    ...(model.isOpen ? [] : [h.Inert(true)]),
                    h.Class(dialogClassNames.content),
                  ],
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

export const isDialogVisible = (dialog: DialogModel): boolean =>
  dialog.isOpen ||
  dialog.animation.transitionState === "LeaveStart" ||
  dialog.animation.transitionState === "LeaveAnimating";

type ModelWithDialog<OutMessage> = Readonly<{
  dialog: DialogModel;
  maybeOutMessageAfterClose: Option.Option<OutMessage>;
}>;

type DialogFoldsConfig<Model, Message> = Readonly<{
  toParentMessage: (message: DialogMessage) => Message;
  whenClosed?: (model: Model) => Model;
  isClosingBlocked: (model: Model) => boolean;
}>;

const isRequestedClose = Schema.is(FoldkitDialog.Message.RequestedClose);

const isClosing = (dialog: DialogModel): boolean => !dialog.isOpen && isDialogVisible(dialog);

export const dialogFoldsOf =
  <OutMessage>() =>
  <Model extends ModelWithDialog<OutMessage>, Message>(
    config: DialogFoldsConfig<Model, Message>,
  ) => {
    type DialogReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>;
    const child = {
      read: (model: Model) => Option.some(model.dialog),
      write: (model: Model, nextDialog: DialogModel): Model => ({ ...model, dialog: nextDialog }),
      toParentMessage: config.toParentMessage,
      foldOutMessage: FoldkitDialog.OutMessage.match<Update.Step<Model, Message>>({
        Opened: () => (model) => ({ model }),
        Closed: () => (model) => ({ model }),
      }),
    };
    const foldDialog = Update.foldChild({ ...child, update: FoldkitDialog.update });
    const open = Update.foldChildStep({ ...child, update: FoldkitDialog.open });
    const close = Update.foldChildStep({ ...child, update: FoldkitDialog.close });
    const settledAfterClose = (model: Model): Model => ({
      ...(config.whenClosed ?? identity)(model),
      maybeOutMessageAfterClose: Option.none(),
    });
    const settleOnceHidden =
      (wasClosing: boolean): Update.Step<Model, Message> =>
      (stepModel) => ({
        model:
          !isDialogVisible(stepModel.dialog) &&
          (wasClosing || Option.isSome(stepModel.maybeOutMessageAfterClose))
            ? settledAfterClose(stepModel)
            : stepModel,
      });
    const reportOnceHidden = (
      dialogStepped: Update.Return<Model, Message>,
      maybeOutMessage: Option.Option<OutMessage>,
    ): DialogReturn =>
      pipe(
        dialogStepped,
        Update.withOutMessage(
          isDialogVisible(dialogStepped.model.dialog)
            ? undefined
            : Option.getOrUndefined(maybeOutMessage),
        ),
      );
    const holding = (model: Model, outMessage: OutMessage): Model => ({
      ...model,
      maybeOutMessageAfterClose: Option.some(outMessage),
    });
    return {
      fold: (model: Model, message: DialogMessage): DialogReturn =>
        config.isClosingBlocked(model) && isRequestedClose(message)
          ? { model }
          : reportOnceHidden(
              Update.combine(model, [
                foldDialog(message),
                settleOnceHidden(isClosing(model.dialog)),
              ]),
              model.maybeOutMessageAfterClose,
            ),
      open: (model: Model): DialogReturn =>
        isClosing(model.dialog)
          ? pipe(
              open(settledAfterClose(model)),
              Update.withOutMessage(Option.getOrUndefined(model.maybeOutMessageAfterClose)),
            )
          : open(model),
      close,
      closeThen: (model: Model, outMessage: OutMessage): DialogReturn =>
        reportOnceHidden(
          Update.combine(holding(model, outMessage), [close, settleOnceHidden(false)]),
          Option.some(outMessage),
        ),
      reportAfterClose: (model: Model, outMessage: OutMessage): DialogReturn =>
        reportOnceHidden(
          settleOnceHidden(false)(holding(model, outMessage)),
          Option.some(outMessage),
        ),
    };
  };
