import { Button } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { IconNode } from "lucide";

import { Submission } from "../submission";
import { cn } from "../utils";
import { buttonVariants, smallLinkButtonClassName, subtleLinkButtonClassName } from "./class-names";
import { iconView, spinnerView } from "./icon-view";

type ButtonLook =
  | "primary"
  | "primaryInline"
  | "outline"
  | "outlineInline"
  | "outlineSmall"
  | "destructive"
  | "listRow"
  | "navItem"
  | "subtleLink"
  | "smallLink";

const CLASS_BY_LOOK: Record<ButtonLook, string> = {
  primary: `${buttonVariants({ variant: "default" })} w-full`,
  primaryInline: buttonVariants({ variant: "default" }),
  outline: `${buttonVariants({ variant: "outline" })} w-full`,
  outlineInline: buttonVariants({ variant: "outline" }),
  destructive: buttonVariants({ variant: "destructive" }),
  navItem:
    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  outlineSmall: buttonVariants({ variant: "outline", size: "sm" }),
  listRow: cn(
    buttonVariants({ variant: "ghost" }),
    "h-auto w-full justify-between gap-3 whitespace-normal py-2 text-left font-normal disabled:text-muted-foreground disabled:opacity-100",
  ),
  subtleLink: subtleLinkButtonClassName,
  smallLink: smallLinkButtonClassName,
};

type SubmitValue = Readonly<{ name: string; value: string }>;

export type ButtonViewConfig<Message> = Readonly<{
  label: string;
  type: "button" | "submit";
  look: ButtonLook;
  submission: Submission;
  isBlocked: boolean;
  onClick?: Message;
  icon?: IconNode;
  submitValue?: SubmitValue;
  note?: string;
  submittingLabel?: string;
}>;

const labelContentOf = <Message>(
  config: ButtonViewConfig<Message>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> =>
  config.look === "listRow"
    ? [
        h.span([h.Class("min-w-0 break-all")], [config.label]),
        ...(config.note === undefined
          ? []
          : [h.span([h.Class("shrink-0 text-xs")], [config.note])]),
      ]
    : [
        Submission.guards.Submitting(config.submission) && config.submittingLabel !== undefined
          ? config.submittingLabel
          : config.label,
      ];

const leadingIconView = <Message>(
  submission: Submission,
  icon: IconNode | undefined,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Submission.guards.Submitting(submission)
    ? [spinnerView(h)]
    : icon === undefined
      ? []
      : [iconView(icon, h)];

export const buttonView = <Message>(
  config: ButtonViewConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  Button.view(
    {
      type: config.type,
      onClick: config.onClick,
      isDisabled: config.isBlocked || Submission.guards.Submitting(config.submission),
      toView: (attributes) =>
        h.button(
          [
            ...attributes.button,
            h.Class(CLASS_BY_LOOK[config.look]),
            ...(config.submitValue === undefined
              ? []
              : [
                  h.Name(config.submitValue.name),
                  h.Value(config.submitValue.value),
                  h.Disabled(config.isBlocked),
                ]),
          ],
          [...leadingIconView(config.submission, config.icon, h), ...labelContentOf(config, h)],
        ),
    },
    h,
  );

export const buttonLinkView = <Message>(
  config: Readonly<{ label: string; href: string }>,
  h: HtmlBuilder<Message>,
): Html => h.a([h.Href(config.href), h.Class(CLASS_BY_LOOK.primary)], [config.label]);
