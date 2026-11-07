import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { CircleAlert } from "lucide";

import { alertClassNames, alertVariants } from "../../shared/ui/class-names";
import { iconView } from "../../shared/ui/icon-view";
import { errorPageMessage, type ErrorPageReason } from "../auth-error-reason";

export const authErrorView = <Message>(
  h: HtmlBuilder<Message>,
  reason: Option.Option<ErrorPageReason>,
): Html => {
  const message = errorPageMessage(Option.getOrUndefined(reason));
  return h.div(
    [
      h.Class(
        "flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10",
      ),
    ],
    [
      h.div(
        [h.Class("w-full max-w-sm")],
        [
          h.div(
            [h.Role("alert"), h.Class(alertVariants({ variant: "destructive" }))],
            [
              iconView(h, CircleAlert),
              h.h5([h.Class(alertClassNames.title)], [message.title]),
              h.div([h.Class(alertClassNames.description)], [message.description]),
            ],
          ),
        ],
      ),
    ],
  );
};
