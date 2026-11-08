import { Button } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { IconNode } from "lucide";

import { Submission } from "../submission";
import { buttonVariants, smallLinkButtonClassName, subtleLinkButtonClassName } from "./class-names";
import { iconView, spinnerView } from "./icon-view";

type ButtonLook = "primary" | "outline" | "subtleLink" | "smallLink";

const CLASS_BY_LOOK: Record<ButtonLook, string> = {
  primary: `${buttonVariants({ variant: "default" })} w-full`,
  outline: `${buttonVariants({ variant: "outline" })} w-full`,
  subtleLink: subtleLinkButtonClassName,
  smallLink: smallLinkButtonClassName,
};

export type ButtonViewConfig<Message> = Readonly<{
  label: string;
  type: "button" | "submit";
  look: ButtonLook;
  submission: Submission;
  isBlocked: boolean;
  onClick?: Message;
  icon?: IconNode;
}>;

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
          [...attributes.button, h.Class(CLASS_BY_LOOK[config.look])],
          [...leadingIconView(config.submission, config.icon, h), config.label],
        ),
    },
    h,
  );

export const buttonLinkView = <Message>(
  config: Readonly<{ label: string; href: string }>,
  h: HtmlBuilder<Message>,
): Html => h.a([h.Href(config.href), h.Class(CLASS_BY_LOOK.primary)], [config.label]);
