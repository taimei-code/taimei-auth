import type { Html, HtmlBuilder } from "foldkit/html";

import { cardClassNames } from "../shared/ui/class-names";

type AuthPageCardWidth = "sm" | "md";

const CARD_WIDTH_CLASS: Record<AuthPageCardWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
};

type AuthPageCardContent = Readonly<{
  title: string;
  description: string;
  width: AuthPageCardWidth;
  content: ReadonlyArray<Html>;
  hidden?: ReadonlyArray<Html>;
  outside?: ReadonlyArray<Html>;
}>;

export const authPageCardView = <Message>(
  card: AuthPageCardContent,
  h: HtmlBuilder<Message>,
): Html =>
  h.main(
    [
      h.Class(
        "relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10",
      ),
    ],
    [
      ...(card.hidden ?? []),
      h.div(
        [h.Class(`${cardClassNames.root} w-full ${CARD_WIDTH_CLASS[card.width]}`)],
        [
          h.div(
            [h.Class(cardClassNames.header)],
            [
              h.h1([h.Class(cardClassNames.title)], [card.title]),
              h.div([h.Class(cardClassNames.description)], [card.description]),
            ],
          ),
          h.div([h.Class(`${cardClassNames.content} space-y-4`)], card.content),
          h.div(
            [h.Class(`${cardClassNames.footer} text-xs text-muted-foreground`)],
            ["URL が auth.taimei-code.com であることを確認してください"],
          ),
        ],
      ),
      ...(card.outside ?? []),
    ],
  );
