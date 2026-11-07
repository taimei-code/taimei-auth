import { Dialog } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";
import { X } from "lucide";

import { dialogClassNames } from "./class-names";
import { iconView } from "./icon-view";

export const DialogModel = Dialog.Model;
export type DialogModel = Dialog.Model;
export type DialogMessage = Dialog.Message;
export const DialogOutMessage = Dialog.OutMessage;
export const initDialog = Dialog.init;
export const updateDialog = Dialog.update;
export const openDialog = Dialog.open;
export const closeDialog = Dialog.close;

export type DialogContent = Readonly<{
  title: string;
  description: string;
  body: ReadonlyArray<Html>;
  isClosingBlocked: boolean;
}>;

export const dialogView = <Message>(
  h: HtmlBuilder<Message>,
  model: DialogModel,
  toParentMessage: (message: DialogMessage) => Message,
  content: DialogContent,
): Html =>
  h.submodel({
    slotId: model.id,
    model,
    view: Dialog.view,
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
                      [iconView(h, X), h.span([h.Class("sr-only")], ["Close"])],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage,
  });
