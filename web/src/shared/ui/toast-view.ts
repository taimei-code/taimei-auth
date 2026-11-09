import { Toast } from "@foldkit/ui";
import { Duration, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { X } from "lucide";

import { iconView } from "./icon-view";

const Notice = Schema.Struct({ text: Schema.String });

export const NoticeToast = Toast.make(Notice);

export const NoticeTone = Schema.Literals(["Success", "Error"]);
export type NoticeTone = typeof NoticeTone.Type;

export const ReloadTexts = Schema.Struct({ doneText: Schema.String, actionText: Schema.String });
export type ReloadTexts = typeof ReloadTexts.Type;

const DURATION_BY_TONE: Record<NoticeTone, Duration.Input> = {
  Success: Duration.seconds(4),
  Error: Duration.seconds(10),
};

export const noticeOf = (tone: NoticeTone, text: string) => ({
  variant: tone,
  payload: { text },
  duration: DURATION_BY_TONE[tone],
});

export const staleNoticeOf = (actionText: string): string =>
  `${actionText}が、表示の更新に失敗しました。ページを再読み込みしてください。`;

const ENTRY_CLASS_BY_TONE: Record<NoticeTone, string> = {
  Success: "",
  Error: "border-destructive/40 bg-destructive/10 text-destructive",
};

const entryClassOf = (variant: string): string =>
  variant === "Error" ? ENTRY_CLASS_BY_TONE.Error : ENTRY_CLASS_BY_TONE.Success;

export const noticeToastView = <Message>(
  model: typeof NoticeToast.Model.Type,
  toParentMessage: (message: typeof NoticeToast.Message.Type) => Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.id,
    model,
    view: NoticeToast.view,
    viewInputs: {
      position: "BottomRight",
      ariaLabel: "通知",
      containerClassName: "z-[100] flex flex-col gap-2 p-4",
      entryToView: (entry, handlers) =>
        h.div(
          [
            h.Class(
              `flex w-80 items-start gap-3 rounded-md border bg-background p-4 text-sm shadow-lg ${entryClassOf(entry.variant)}`,
            ),
          ],
          [
            h.p([h.Class("flex-1")], [entry.payload.text]),
            ...(entry.variant === "Error"
              ? [
                  h.button(
                    [
                      ...handlers.dismiss,
                      h.Type("button"),
                      h.Class("shrink-0 rounded-sm opacity-70 hover:opacity-100"),
                    ],
                    [iconView(X, h), h.span([h.Class("sr-only")], ["閉じる"])],
                  ),
                ]
              : []),
          ],
        ),
    },
    toParentMessage,
  });
