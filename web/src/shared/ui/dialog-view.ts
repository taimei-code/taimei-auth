import { Dialog as FoldkitDialog } from "@foldkit/ui";
import { identity, Option, pipe, Predicate, Schema } from "effect";
import { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { X } from "lucide";

import { dialogClassNames } from "./class-names";
import { iconView } from "./icon-view";

type DialogInitConfig = Omit<FoldkitDialog.InitConfig, "isAnimated">;

export const Dialog = {
  Model: FoldkitDialog.Model,
  Message: FoldkitDialog.Message,
  init: (config: DialogInitConfig) => FoldkitDialog.init({ ...config, isAnimated: true }),
  ShowDialog: FoldkitDialog.ShowDialog,
  CloseDialog: FoldkitDialog.CloseDialog,
  AcquireResources: FoldkitDialog.AcquireResources,
  ReleaseDialogResources: FoldkitDialog.ReleaseDialogResources,
};
export type DialogModel = FoldkitDialog.Model;
export type DialogMessage = FoldkitDialog.Message;

export type ReportingDialogModel<OutMessage> = DialogModel &
  Readonly<{ maybeOutMessageAfterClose: Option.Option<OutMessage> }>;

export const ReportingDialog = {
  Model: <OutMessage extends Schema.Top>(outMessage: OutMessage) =>
    Schema.Struct({
      ...FoldkitDialog.Model.fields,
      maybeOutMessageAfterClose: Schema.Option(outMessage),
    }),
  init: (config: DialogInitConfig): ReportingDialogModel<never> => ({
    ...Dialog.init(config),
    maybeOutMessageAfterClose: Option.none(),
  }),
};

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

const isDialogModel = Schema.is(FoldkitDialog.Model);

const visibleDialogsIn = (discarded: unknown): ReadonlyArray<DialogModel> => {
  if (!Predicate.isObjectOrArray(discarded)) {
    return [];
  }
  if (isDialogModel(discarded)) {
    return isDialogVisible(discarded) ? [discarded] : [];
  }
  return Object.values(discarded).flatMap(visibleDialogsIn);
};

export const releaseDialogsIn = (discarded: unknown) =>
  visibleDialogsIn(discarded).map(({ id }) => FoldkitDialog.ReleaseDialogResources({ id }));

const isReportingDialogModel = Schema.is(ReportingDialog.Model(Schema.Unknown));

export const hasHeldReportIn = (discarded: unknown): boolean =>
  visibleDialogsIn(discarded).some(
    (dialog) => isReportingDialogModel(dialog) && Option.isSome(dialog.maybeOutMessageAfterClose),
  );

type ModelWithDialog = Readonly<{ dialog: DialogModel }>;

type ModelWithSilentDialog = Readonly<{
  dialog: DialogModel & Readonly<{ maybeOutMessageAfterClose?: never }>;
}>;

type ModelWithReportingDialog<OutMessage> = Readonly<{
  dialog: ReportingDialogModel<OutMessage>;
}>;

type DialogFoldsConfig<Model, Message> = Readonly<{
  toParentMessage: (message: DialogMessage) => Message;
  whenClosed?: (model: Model) => Model;
  isClosingBlocked: (model: Model) => boolean;
}>;

type HeldReport<Model, OutMessage> = Readonly<{
  read: (model: Model) => Option.Option<OutMessage>;
  write: (model: Model, maybeOutMessage: Option.Option<OutMessage>) => Model;
}>;

const isRequestedClose = Schema.is(FoldkitDialog.Message.RequestedClose);

const isClosing = (dialog: DialogModel): boolean => !dialog.isOpen && isDialogVisible(dialog);

const dialogFoldsHolding = <Model extends ModelWithDialog, Message, OutMessage>(
  config: DialogFoldsConfig<Model, Message>,
  held: HeldReport<Model, OutMessage>,
) => {
  type DialogReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>;
  const child = {
    read: (model: Model) => Option.some(model.dialog),
    write: (model: Model, nextDialog: DialogModel): Model => ({
      ...model,
      dialog: { ...model.dialog, ...nextDialog },
    }),
    toParentMessage: config.toParentMessage,
    foldOutMessage: FoldkitDialog.OutMessage.match<Update.Step<Model, Message>>({
      Opened: () => (model) => ({ model }),
      Closed: () => (model) => ({ model }),
    }),
  };
  const foldDialog = Update.foldChild({ ...child, update: FoldkitDialog.update });
  const open = Update.foldChildStep({ ...child, update: FoldkitDialog.open });
  const close = Update.foldChildStep({ ...child, update: FoldkitDialog.close });
  const settledAfterClose = (model: Model): Model =>
    held.write((config.whenClosed ?? identity)(model), Option.none());
  const settleOnceHidden =
    (wasClosing: boolean): Update.Step<Model, Message> =>
    (stepModel) => ({
      model:
        !isDialogVisible(stepModel.dialog) && (wasClosing || Option.isSome(held.read(stepModel)))
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
  const holding = (model: Model, outMessage: OutMessage): Model =>
    held.write(model, Option.some(outMessage));
  return {
    fold: (model: Model, message: DialogMessage): DialogReturn =>
      config.isClosingBlocked(model) && isRequestedClose(message)
        ? { model }
        : reportOnceHidden(
            Update.combine(model, [foldDialog(message), settleOnceHidden(isClosing(model.dialog))]),
            held.read(model),
          ),
    open: (model: Model): DialogReturn =>
      isClosing(model.dialog)
        ? pipe(
            open(settledAfterClose(model)),
            Update.withOutMessage(Option.getOrUndefined(held.read(model))),
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

export const dialogFoldsOf = <Model extends ModelWithSilentDialog, Message>(
  config: DialogFoldsConfig<Model, Message>,
) => {
  const { fold, open, close } = dialogFoldsHolding<Model, Message, never>(config, {
    read: Option.none,
    write: identity,
  });
  return { fold, open, close };
};

export const reportingDialogFoldsOf =
  <OutMessage>() =>
  <Model extends ModelWithReportingDialog<OutMessage>, Message>(
    config: DialogFoldsConfig<Model, Message>,
  ) =>
    dialogFoldsHolding<Model, Message, OutMessage>(config, {
      read: (model) => model.dialog.maybeOutMessageAfterClose,
      write: (model, maybeOutMessageAfterClose) => ({
        ...model,
        dialog: { ...model.dialog, maybeOutMessageAfterClose },
      }),
    });
