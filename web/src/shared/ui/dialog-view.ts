import { Dialog as FoldkitDialog } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";
import { X } from "lucide";

import { dialogClassNames } from "./class-names";
import { iconView } from "./icon-view";

export const Dialog = {
  Model: FoldkitDialog.Model,
  Message: FoldkitDialog.Message,
  OutMessage: FoldkitDialog.OutMessage,
  init: FoldkitDialog.init,
  update: FoldkitDialog.update,
  open: FoldkitDialog.open,
  close: FoldkitDialog.close,
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
